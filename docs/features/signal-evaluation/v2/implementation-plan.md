# Signal Evaluation V2 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V2.

Read this document first:
docs/features/signal-evaluation/v2/implementation-plan.md

Objective:
- Persist immutable SignalObservation records for each factor and composite
  signal run so later evaluation is based on point-in-time signal evidence, not
  thesis-attached inference.
```

## One Outcome

Every SignalEngine run produces auditable observation rows that answer:

```text
What did this detector/composite say at this exact time, with which inputs,
code/config versions, availability state, and data quality?
```

V2 creates the data foundation for V3/V4. It does not label outcomes yet.

## Non-Goals

- Do not compute future market outcomes.
- Do not train weights.
- Do not publish empirical probabilities.
- Do not remove existing `signals` or `signal_snapshots` behavior.
- Do not rewrite factor detectors beyond adding observation-friendly metadata.

## Current Problem

Current persisted `Signal` records are useful for UI/provenance, but they are
not sufficient as a clean evaluation dataset:

- factor confidence is persisted, but direction, data quality, and availability
  are not normalized as evaluation primitives;
- parse failures and missing data can collapse into neutral or low confidence;
- factor reliability currently derives from thesis outcomes, not factor
  observations;
- code/config versions are partly present but not normalized for replay
  grouping;
- composite output and factor output are not stored in one observation schema.

## Observation Model

Add a first-class immutable observation record.

```python
class SignalObservation:
    id: str
    workspace_id: str
    research_run_id: str | None
    signal_snapshot_id: str | None
    signal_id: str | None

    symbol: str
    timeframe: str
    observed_at: datetime
    source_timestamp: datetime | None

    observation_kind: Literal["factor", "composite"]
    factor_name: str
    factor_family: str

    direction: Literal["bullish", "bearish", "neutral", "mixed", "unknown"]
    directional_edge: float | None
    heuristic_strength: float | None
    detector_confidence: float | None
    data_quality: float | None
    availability: Literal["valid", "missing", "stale", "parse_failed", "error"]

    raw_value: float | None
    threshold_breached: bool
    market_regime: str
    volatility_regime: str

    provider: str | None
    source_snapshot_hash: str | None
    code_sha: str | None
    signal_weight_version: str
    signal_threshold_version: str
    detector_version: str

    evidence_json: dict
    metadata_json: dict
    created_at: datetime
```

Rules:

- observations are insert-only;
- no update path except explicit backfill/admin repair with audit metadata;
- `directional_edge = 0` means valid no directional edge;
- `directional_edge = null` means unavailable or invalid;
- `availability != valid` rows never count as directional evidence;
- `composite` rows use `factor_name = "quant_bias"`.

## Factor Families

Normalize families so correlated factors can be grouped later.

```text
price_momentum: rsi_divergence, macd
price_structure: regime
volume: volume_profile
derivatives: funding_oi, liquidations
market_structure_proxy: onchain
aggregate: quant_bias
unknown: unclassified
```

V2 should preserve legacy factor names while adding family metadata.

## Persistence

### API Database

Add a table to the canonical SQL schema and Prisma schema if the API database
is the source of truth for web-facing signal evaluation:

```sql
CREATE TABLE signal_observations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  research_run_id TEXT,
  signal_snapshot_id TEXT,
  signal_id TEXT,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_timestamp TIMESTAMPTZ,
  observation_kind TEXT NOT NULL,
  factor_name TEXT NOT NULL,
  factor_family TEXT NOT NULL,
  direction TEXT NOT NULL,
  directional_edge DOUBLE PRECISION,
  heuristic_strength DOUBLE PRECISION,
  detector_confidence DOUBLE PRECISION,
  data_quality DOUBLE PRECISION,
  availability TEXT NOT NULL,
  raw_value DOUBLE PRECISION,
  threshold_breached BOOLEAN NOT NULL DEFAULT FALSE,
  market_regime TEXT NOT NULL DEFAULT 'unknown',
  volatility_regime TEXT NOT NULL DEFAULT 'unknown',
  provider TEXT,
  source_snapshot_hash TEXT,
  code_sha TEXT,
  signal_weight_version TEXT NOT NULL DEFAULT 'unknown',
  signal_threshold_version TEXT NOT NULL DEFAULT 'unknown',
  detector_version TEXT NOT NULL DEFAULT 'unknown',
  evidence_json JSONB NOT NULL DEFAULT '{}',
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes:

```sql
CREATE INDEX idx_signal_observations_workspace_observed
  ON signal_observations (workspace_id, observed_at DESC);

CREATE INDEX idx_signal_observations_workspace_symbol
  ON signal_observations (workspace_id, symbol, observed_at DESC);

CREATE INDEX idx_signal_observations_factor
  ON signal_observations (workspace_id, factor_name, observed_at DESC);

CREATE INDEX idx_signal_observations_snapshot
  ON signal_observations (workspace_id, signal_snapshot_id);
```

### Local Journal

If SQLite remains the local AI-service cache, mirror the table with compatible
types and keep JSON fields as text. The API sync path must move observation
rows with the same ids.

## Runtime Integration

Add an observation builder near signal provenance conversion:

```text
SignalResult + FactorSignal + provenance context
  -> Signal records
  -> SignalSnapshot
  -> SignalObservation rows
```

Preferred code placement:

```text
apps/ai-service/luna_workstation/signals/observations.py
apps/ai-service/luna_workstation/storage/repositories/signal_observations.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
```

Do not parse UI text to build observations. Use structured `SignalResult` and
`FactorSignal` objects before rendering.

## API Surface

Add read-only endpoints only if needed for verification and future UI:

```text
GET /signals/observations?symbol=&factor=&from=&to=&limit=
GET /signals/observations/:id
```

Response shape:

```ts
interface SignalObservationResponse {
  id: string;
  workspace_id: string;
  research_run_id: string | null;
  signal_snapshot_id: string | null;
  signal_id: string | null;
  symbol: string;
  timeframe: string;
  observed_at: string;
  source_timestamp: string | null;
  observation_kind: 'factor' | 'composite';
  factor_name: string;
  factor_family: string;
  direction: string;
  directional_edge: number | null;
  heuristic_strength: number | null;
  detector_confidence: number | null;
  data_quality: number | null;
  availability: string;
  market_regime: string;
  volatility_regime: string;
  provider: string | null;
  versions: {
    code_sha: string | null;
    signal_weight_version: string;
    signal_threshold_version: string;
    detector_version: string;
  };
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
}
```

## Backfill

V2 may include a best-effort backfill from existing `signals` rows.

Rules:

- mark `metadata_json.backfilled = true`;
- set `detector_version = "legacy_signal_record"`;
- set unavailable fields to `unknown` or null;
- never imply exact source snapshot hash if it was not persisted.

Backfill is useful for UI continuity, but V3/V4 should prefer native V2
observations when computing official metrics.

## Required Tests

AI-service:

- each SignalEngine run creates one composite observation and one observation
  per factor;
- valid neutral has `directional_edge = 0` and `availability = valid`;
- parse failure/missing source has null edge and non-valid availability;
- observation ids are stable enough to avoid duplicate insert on retry;
- observation rows include version fields.

API:

- repository creates and lists observations scoped by workspace;
- sync preserves observation ids and JSON fields;
- read endpoint filters by symbol, factor, and time range;
- existing `/signals` behavior is unchanged.

Schema:

- Postgres and Prisma schema include table and indexes;
- migrations are additive.

## Validation Loop

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and observation"
pnpm --filter @lunaperception/api test -- api-contract
pnpm --filter @lunaperception/api test -- signal
git diff --check
```

## Definition Of Done

- Signal observations are persisted for factor and composite outputs.
- Observation rows are immutable and workspace-scoped.
- Availability, data quality, heuristic strength, and directional edge are
  normalized.
- Existing signal UI/API contracts keep working.
- V3 can label outcomes without reading thesis records.

## Stop Rules

Stop and write a follow-up if:

- source data snapshots are not available and exact hashing would be invented;
- implementing observations requires changing detector scoring behavior;
- a migration would break existing `signals` consumers;
- outcome labeling or walk-forward metrics start entering the V2 patch.
