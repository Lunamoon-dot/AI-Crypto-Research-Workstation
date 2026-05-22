# Calibration Lab V1.2 Implementation Plan

Last updated: 2026-05-22  
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.2 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.2/implementation-plan.md

Objective:
- Add a read-only Symbol Calibration MVP that aggregates existing
  ThesisEvaluation rows for one symbol/window/lookback period and reports
  coverage, stance, outcome metrics, and a deterministic verdict.

Required behavior:
- /calibration supports mode=single, mode=batch, and mode=symbol.
- /calibration?mode=symbol shows a Symbol Calibration panel.
- GET /calibration/symbol returns a workspace-scoped symbol calibration report.
- The report uses only persisted TradeThesis and ThesisEvaluation data.
- The report does not call the Python engine, market data providers, or any LLM.
- The report includes evaluated and missing-evaluation supporting rows.
- If coverage is low, the UI can prepare the V1.1 batch panel for the same
  symbol/window, but must not auto-apply.

Do not implement:
- LLM stance parsing or free-text thesis interpretation.
- Automatic batch evaluation.
- OutcomeReview creation.
- Provider OHLCV fetching.
- Persisted SymbolCalibrationReport tables or report snapshots.
- Agent calibration.
- Evaluation rerun/re-evaluate/audit replacement policy.
- Scheduler/background jobs, charts, custom date ranges, export, subscriptions,
  paywalls, or broad analytics dashboards.

Definition of done:
- The API report computes coverage, stance, outcome, verdict, and compact rows
  from existing rows.
- The web UI exposes Symbol Calibration as a mode inside /calibration.
- The CTA to batch evaluation only pre-fills/opens batch mode and keeps apply
  explicit.
- Focused API tests cover filtering, coverage, stance, outcome metrics, rows,
  empty/inconclusive cases, and validation.
- API build/test and web typecheck pass, or exact blockers are documented.
```

## One Outcome

Add Symbol Calibration MVP for one symbol at a time.

V1.2 answers:

```text
For BTC/USDT over a 7d forward window and a recent 30d thesis period, how well
did the existing evaluated thesis cluster perform?
```

It is a read-only reliability view. It aggregates data already produced by V1
and V1.1.

## Version Placement

```text
V1    Manual single-thesis evaluation.
V1.1  Batch matured evaluation: preview -> explicit bounded apply.
V1.2  Symbol Calibration MVP: read-only aggregate by symbol/window/lookback.
V1.3  Evaluation versioning / rerun audit.
V1.4  Agent Calibration MVP.
V2.0  Background jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration reports / snapshots.
V2.x  Charts, historical replay, LLM stance parsing, and deeper analytics.
```

V1.2 must not absorb V1.3, V1.4, or V2 work.

## Resolved Decisions

- V1.2 does not use LLM.
- V1.2 does not call the Python engine.
- V1.2 does not fetch fresh market data.
- V1.2 does not write DB rows.
- V1.2 computes reports on read from `TradeThesis` and `ThesisEvaluation`.
- V1.2 does not create `OutcomeReview`.
- V1.2 API route:

```text
GET /calibration/symbol
```

- Query params:

```text
symbol=BTC/USDT
window_days=7
lookback_days=30
```

- Valid `window_days`:

```text
7, 14, 30
```

- Valid `lookback_days`:

```text
30, 60, 90
```

- Default lookback is `30`.
- Longer historical windows such as `180`, `365`, and custom ranges are future
  subscription/product work, not V1.2.
- Filtering is based on thesis creation date / evaluation start, not
  `evaluated_at`.
- Report period is computed as:

```text
period_end   = today_utc - window_days - 1
period_start = period_end - (lookback_days - 1)
```

- Include matured theses for the symbol whose thesis created date is between
  `period_start` and `period_end`.
- Coverage denominator is matured thesis count, not all recent theses.
- Supporting rows include evaluated and missing-evaluation rows.
- Supporting rows are capped at 20.
- UI uses `/calibration?mode=symbol`.
- Old `/calibration?thesis_id=<id>` behavior remains single-thesis mode.
- Symbol Calibration can show a CTA to prepare batch evaluation, but it must not
  auto-apply.

## API Contract

Request:

```text
GET /calibration/symbol?symbol=BTC%2FUSDT&window_days=7&lookback_days=30
```

Response:

```json
{
  "symbol": "BTC/USDT",
  "window_days": 7,
  "lookback_days": 30,
  "period_start": "2026-04-15",
  "period_end": "2026-05-14",
  "coverage": {
    "matured_thesis_count": 12,
    "evaluated_count": 9,
    "missing_evaluation_count": 3,
    "coverage_pct": 0.75
  },
  "stance": {
    "stance_counts": {
      "bullish": 2,
      "bearish": 1,
      "defensive": 5,
      "neutral": 1,
      "unknown": 3
    },
    "consensus_stance": "defensive",
    "conflict_rate": 0.375
  },
  "outcome": {
    "result_counts": {
      "hit_target": 4,
      "invalidated": 1,
      "mixed": 1,
      "expired": 2,
      "unknown": 1
    },
    "hit_rate": 0.4444,
    "invalidation_rate": 0.1111,
    "mixed_rate": 0.1111,
    "expired_rate": 0.2222,
    "unknown_rate": 0.1111,
    "avg_mfe": 0.041,
    "avg_mae": -0.026,
    "best_mfe": 0.11,
    "worst_mae": -0.08,
    "representative_return": -0.018,
    "verdict": "correct"
  },
  "rows": [
    {
      "thesis_id": "thesis_abc",
      "created_at": "2026-05-01T08:15:00.000Z",
      "symbol": "BTC/USDT",
      "stance": "defensive",
      "direction": "avoid",
      "confidence": 0.67,
      "status": "evaluated",
      "evaluation_id": "evaluation_abc",
      "result": "hit_target",
      "max_favorable_excursion": 0.052,
      "max_adverse_excursion": -0.013
    },
    {
      "thesis_id": "thesis_missing",
      "created_at": "2026-05-03T11:00:00.000Z",
      "symbol": "BTC/USDT",
      "stance": "bullish",
      "direction": "long",
      "confidence": 0.72,
      "status": "missing_evaluation",
      "evaluation_id": null,
      "result": null,
      "max_favorable_excursion": null,
      "max_adverse_excursion": null
    }
  ]
}
```

## Data And Computation Rules

### Coverage

Matured thesis:

```text
symbol matches normalized requested symbol
thesis.created_at date between period_start and period_end
thesis.created_at date + window_days < today_utc
```

Evaluation match uses the V1 natural key:

```text
workspace_id + thesis_id + window_days + evaluation_start + evaluation_end
```

Coverage:

```text
matured_thesis_count = count(matured theses)
evaluated_count = count(matured theses with matching ThesisEvaluation)
missing_evaluation_count = matured_thesis_count - evaluated_count
coverage_pct = evaluated_count / matured_thesis_count
```

If `matured_thesis_count = 0`:

```text
coverage_pct = null
verdict = inconclusive
```

### Stance

Use structured fields only.

Priority:

```text
1. thesis.direction
2. existing structured payload stance fields if already present:
   payload.structured_summary.stance
   payload.summary.stance
   payload.stance
3. unknown
```

Do not parse free text with LLM in V1.2.

Mapping:

```text
long / bullish / overweight       -> bullish
short / bearish / underweight     -> bearish
avoid / defensive / risk_off      -> defensive
watch / neutral                   -> neutral
missing / unmapped                -> unknown
tie across top stances            -> mixed
```

Consensus:

```text
consensus_stance = highest count among bullish/bearish/defensive/neutral
consensus_stance = mixed when top counts tie
consensus_stance = unknown when no classified stance exists
```

Conflict:

```text
conflict_rate = non_consensus_classified_count / classified_count
```

`unknown` is excluded from classified count.

### Outcome Metrics

Use evaluated rows only.

Result counts:

```text
hit_target
invalidated
mixed
expired
unknown
```

Rates:

```text
rate = result_count / evaluated_count
```

Metric derivation:

```text
per_evaluation_return = (end_price - start_price) / start_price
representative_return = average(per_evaluation_return)
avg_mfe = average(max_favorable_excursion)
avg_mae = average(max_adverse_excursion)
best_mfe = max(max_favorable_excursion)
worst_mae = min(max_adverse_excursion)
```

If `start_price` / `end_price` are not top-level fields, read them from
`evaluation.evidence.start_price` and `evaluation.evidence.end_price`.

Do not call this full-period BTC return. It is a representative return derived
from evaluation windows.

### Verdict

Thresholds:

```text
material_return = 0.02
material_drawdown = -0.04
```

Rules:

```text
bullish correct:
  representative_return >= 0.02

bearish correct:
  representative_return <= -0.02

defensive correct:
  representative_return <= 0 OR worst_mae <= -0.04

neutral correct:
  abs(representative_return) < 0.02

mixed / unknown:
  inconclusive
```

Output:

```text
correct
incorrect
inconclusive
```

If coverage is zero or there are no evaluated rows, verdict is `inconclusive`.

## UI UX

Route remains:

```text
/calibration
```

Modes:

```text
/calibration?mode=single
/calibration?mode=batch
/calibration?mode=symbol
```

Default mode:

```text
single
```

If `thesis_id` is present, force/assume single mode:

```text
/calibration?thesis_id=<id>
```

Mode control:

```text
[Single Thesis] [Batch Matured] [Symbol Calibration]
```

Symbol Calibration controls:

- symbol text input, placeholder `BTC/USDT`;
- window selector `7d`, `14d`, `30d`;
- lookback selector `30d`, `60d`, `90d`;
- load/generate report button.

Optional if cheap:

- quick-select existing symbols from the already loaded thesis list.

Do not add a new symbol-list API just for autocomplete in V1.2.

Report sections:

```text
Coverage
Stance
Outcome
Supporting rows
```

Supporting rows:

```text
created_at
thesis_id
symbol
stance
direction
confidence
status
evaluation_id
result
MFE
MAE
```

Row statuses:

```text
evaluated
missing_evaluation
invalid_thesis
```

Sort supporting rows:

```text
created_at DESC
thesis_id ASC
```

Cap supporting rows:

```text
20
```

CTA:

If `missing_evaluation_count > 0`, show:

```text
Prepare batch evaluation
```

Click behavior:

```text
mode = batch
batch symbol = current symbol
batch window_days = current window_days
trigger preview if cheap
```

Do not call apply.

## Relevant Context

Current repo facts:

- V1 already stores `ThesisEvaluation`.
- V1.1 already has batch matured evaluation with optional symbol filter.
- `ThesisEvaluation` rows include result, MFE/MAE, warnings, evidence, and
  payload JSON.
- `/calibration` already contains single-thesis and batch workflows.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1.1/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/*.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/*.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Python files should not change for V1.2.

## Implementation Checklist

- [ ] Add V1.2 DTO/query validation for symbol report.
- [ ] Add symbol calibration response types and mappers.
- [ ] Add OpenAPI contract entry if following repo pattern.
- [ ] Add repository method for symbol calibration source rows, or reuse existing
      repository methods if efficient enough.
- [ ] Compute period start/end from `today_utc`, `window_days`, and
      `lookback_days`.
- [ ] Count matured theses and matching evaluations by natural key.
- [ ] Compute stance counts, consensus stance, and conflict rate.
- [ ] Compute result counts, rates, MFE/MAE, representative return, and verdict.
- [ ] Return evaluated and missing-evaluation supporting rows capped at 20.
- [ ] Add controller route `GET /calibration/symbol`.
- [ ] Add web service/query key/type support.
- [ ] Add mode segmented control in `/calibration`.
- [ ] Add Symbol Calibration panel.
- [ ] Add CTA to prepare batch evaluation without auto-apply.
- [ ] Add focused API contract tests.
- [ ] Run validation commands.

## Required Tests

API contract tests:

- [ ] Returns coverage counts and `coverage_pct` from matured/evaluated thesis
      set.
- [ ] Filters by symbol, window, lookback, and workspace.
- [ ] Computes `stance_counts`, `consensus_stance`, and `conflict_rate`.
- [ ] Computes result counts, rates, average MFE/MAE, representative return, and
      verdict.
- [ ] Returns missing-evaluation rows without failing.
- [ ] Caps supporting rows at 20.
- [ ] Returns inconclusive when there are no matured theses or no classified
      stance.
- [ ] Validates `symbol` required.
- [ ] Validates `window_days` only allows `7`, `14`, and `30`.
- [ ] Validates `lookback_days` only allows `30`, `60`, and `90`.

Web:

- [ ] Typecheck passes.

Python:

- [ ] No Python tests required unless Python files are touched.

## Validation Loop

Run:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Open `/calibration`.
- Switch between Single Thesis, Batch Matured, and Symbol Calibration modes.
- Open `/calibration?mode=symbol`.
- Load a symbol report for `BTC/USDT`, `7d`, `30d`.
- Confirm coverage, stance, outcome, and supporting rows render.
- Confirm missing-evaluation rows are visible when coverage is incomplete.
- Click `Prepare batch evaluation` and confirm it opens/prefills batch mode
  without applying.
- Confirm `/calibration?thesis_id=<id>` still opens single-thesis behavior.

## Checkpoint Behavior

Work milestone by milestone:

1. API contract and DTO shape.
2. Repository/source row query.
3. Aggregation and verdict logic.
4. Controller route and API tests.
5. Web mode control and symbol panel.
6. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- do not expand into V1.3/V1.4/V2 work;
- keep unrelated dirty worktree changes intact.

## Stop Rules

Stop and report instead of expanding scope when:

- Symbol Calibration MVP is complete;
- implementation would require LLM parsing, provider calls, engine evaluation,
  report persistence, scheduler/background jobs, agent attribution, custom date
  ranges, subscriptions, or charts;
- repository support is insufficient without a broad data-access rewrite;
- validation fails for external/environment reasons;
- existing code contradicts the plan in a way that affects report semantics.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.2/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.2.

Implement only the V1.2 Symbol Calibration MVP. It is read-only and must not use
LLM, call the Python engine, fetch providers, create OutcomeReview rows, persist
report snapshots, implement agent calibration, rerun evaluations, add
subscriptions, or create scheduler/background jobs.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, repository, contract, React Query, routing, and CSS
patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `/calibration?mode=symbol` renders a Symbol Calibration panel.
- `GET /calibration/symbol` returns a symbol/window/lookback report.
- The report is computed from existing `TradeThesis` and `ThesisEvaluation`
  data only.
- Coverage, stance, outcome metrics, verdict, and compact supporting rows are
  present.
- Missing evaluations are visible and do not fail the report.
- Batch CTA only prepares the V1.1 batch panel and does not auto-apply.
- Focused API tests and web typecheck pass, or blockers are documented.
