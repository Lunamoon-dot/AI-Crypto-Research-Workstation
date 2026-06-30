# Signal Evaluation V1 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V1.

Read this document first:
docs/features/signal-evaluation/v1/implementation-plan.md

Objective:
- Make signal confidence semantics explicit and fix correctness issues in the
  existing signal reliability layer without rewriting SignalEngine.
```

## One Outcome

Users and downstream agents can tell the difference between:

```text
heuristic signal strength
data availability
data quality
historical reliability
empirical probability
```

V1 must stop presenting heuristic signal scores as calibrated probabilities.

## Non-Goals

- Do not replace `SignalEngine`.
- Do not remove the legacy `confidence` field from API contracts.
- Do not train new weights.
- Do not add neural networks or optimizers.
- Do not build broker PnL, fills, fees, slippage, or execution simulation.
- Do not change thesis evaluation result semantics.

## Current Evidence

The current runtime already has a useful foundation:

- deterministic factor detectors;
- versioned signal weights and thresholds;
- provenance and freshness fields;
- persisted `Signal`, `MarketSnapshot`, and `SignalSnapshot` artifacts;
- historical replay and thesis evaluation guardrails;
- separate `heuristic_confidence` and `empirical_confidence` fields.

The V1 defect is mainly semantic and correctness-related:

- `confidence` remains the primary API/UI field;
- Signals page averages factor confidence values;
- factor reliability assigns thesis outcomes to every attached signal;
- short directional accuracy checks `max_adverse_excursion > 0` even though
  short MAE is stored as a negative number;
- confidence curve uses bucket midpoint and signed calibration error;
- parse failure and valid neutral are not first-class separate states;
- `onchain` naming can overstate current proxy data.

## Target Semantics

### Heuristic Strength

Use this for current rule-derived signal output.

```text
heuristic_strength = rule-derived evidence strength on 0.0-1.0 scale
```

Rules:

- it is not a probability;
- it can be displayed for every valid factor;
- it may remain backed by legacy `confidence` internally during V1;
- UI copy must call it `Heuristic strength` or `Evidence strength`.

### Empirical Probability

Use this only when enough validated, out-of-sample observations exist.

```text
empirical_probability = calibrated probability of a defined forward outcome
```

Rules:

- do not show it if sample gates fail;
- display sample size and OOS sample size next to it;
- include horizon in the label, for example `P(up, 24h)`;
- never infer it from heuristic confidence.

### Availability

Each factor must distinguish valid neutral from unavailable data.

```text
valid          = detector ran and produced an interpretable result
missing        = provider/data source not available
stale          = source data exceeded freshness threshold
parse_failed   = source returned data but detector could not parse it
error          = detector failed unexpectedly
```

Valid neutral:

```text
directional_edge = 0
data_quality = 1 or detector-derived value
availability = valid
```

Parse failure:

```text
directional_edge = null
data_quality = 0
availability = parse_failed
```

## V1 Scope

### 1. API And UI Copy Patch

Keep API compatibility but expose safer names.

API response additions:

```ts
heuristic_strength: number | null;
empirical_probability: number | null;
empirical_probability_sample_size: number | null;
empirical_probability_oos_sample_size: number | null;
confidence_semantics: 'heuristic' | 'empirical' | 'unavailable';
```

Compatibility rule:

```text
confidence remains present, but new UI code should not headline it.
```

UI changes:

- Signals list headline: `avg heuristic strength`, not `avg confidence`.
- Signal detail header: `Heuristic strength`, not `Confidence`.
- Empirical probability panel appears only when publishable.
- Raw JSON can still show legacy `confidence`.

### 2. Reliability Correctness Patch

Fix short directional accuracy.

Preferred direction correctness:

```python
forward_return = (end_price - start_price) / start_price
signed_return = (
    forward_return
    if direction == ThesisDirection.LONG
    else -forward_return
)
direction_correct = signed_return > neutral_threshold
```

V1 may use thesis direction because current evaluations are thesis-level, but
the code and labels must state that this is thesis-attached reliability, not
true factor observation reliability.

Rename user-facing copy:

```text
Factor reliability -> Thesis-attached signal reliability
```

### 3. Confidence Curve Metric Patch

Replace signed midpoint error with bucket mean predicted confidence and
absolute calibration error.

For each bucket:

```text
bucket_mean_predicted = mean(thesis.confidence)
bucket_actual_rate = hit_target_count / sample
bucket_error = abs(bucket_actual_rate - bucket_mean_predicted)
```

Overall ECE:

```text
ece = sum(bucket_sample / total_sample * bucket_error)
```

Add Brier score when an evaluated row has a binary outcome:

```text
brier = mean((predicted_probability - outcome) ** 2)
```

V1 must label this as thesis-confidence calibration unless signal observation
outcomes exist.

### 4. Availability Status Foundation

Add availability status to persisted factor evidence where feasible without
schema churn.

Minimum V1 location:

```text
Signal.evidence.availability
Signal.provenance.metadata.availability
```

Do not require a new table in V1.

### 5. On-Chain Proxy Wording

Do not break existing `onchain` signal IDs in V1. Add display/copy metadata:

```text
display_name = "Market structure proxy"
source_note = "Not wallet-level on-chain flow data"
```

Future versions may migrate canonical IDs after compatibility review.

## Data Contract

### Signal Detail Response

Add optional fields:

```ts
interface SignalDetailResponse {
  heuristic_strength: number | null;
  empirical_probability: number | null;
  empirical_probability_sample_size: number | null;
  empirical_probability_oos_sample_size: number | null;
  confidence_semantics: 'heuristic' | 'empirical' | 'unavailable';
  availability: 'valid' | 'missing' | 'stale' | 'parse_failed' | 'error' | 'unknown';
  display_name: string;
  source_note: string | null;
}
```

### Signal List Response

Add:

```ts
interface SignalResponse {
  heuristic_strength: number | null;
  confidence_semantics: 'heuristic' | 'empirical' | 'unavailable';
  availability: 'valid' | 'missing' | 'stale' | 'parse_failed' | 'error' | 'unknown';
  display_name: string;
}
```

## Implementation Steps

1. Add contract mapper fields in `frontend-contract.ts`.
   Verify with API contract tests.

2. Update `SignalsPage.tsx` and `SignalDetailPage.tsx` labels.
   Verify with focused web tests or source assertions.

3. Patch `EvaluationService.build_factor_reliability()` short correctness.
   Verify with a unit test covering short thesis forward loss and forward gain.

4. Patch confidence curve calculations in `EvaluationService`.
   Verify bucket mean, absolute ECE, and Brier score with deterministic fixtures.

5. Add factor availability metadata in signal provenance conversion.
   Verify parse failure/missing data appears as unavailable, not neutral.

6. Add market-structure proxy display metadata for current `onchain` signal.
   Verify API and UI still preserve legacy signal IDs.

## Required Tests

AI-service:

- short thesis with negative forward return is directionally correct;
- short thesis with positive forward return is directionally incorrect;
- confidence curve uses bucket mean predicted confidence;
- ECE uses absolute weighted error;
- Brier score is computed only for binary outcomes;
- factor evidence includes availability when detector data is missing or failed.

API:

- signal list/detail responses include heuristic strength and semantics fields;
- legacy `confidence` remains present;
- `onchain` records expose `Market structure proxy` display metadata.

Web:

- Signals list says `avg heuristic strength`;
- Signal detail says `Heuristic strength`;
- empirical probability is not shown when sample gates fail;
- legacy raw JSON remains accessible.

## Validation Loop

Prefer focused checks:

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "evaluation or signal"
pnpm --filter @lunaperception/api test -- api-contract
pnpm --filter @lunaperception/web test -- signals
git diff --check
```

If package scripts are noisy, run the narrow direct test files that cover the
touched modules.

## Definition Of Done

- No UI surface headlines heuristic confidence as probability.
- Short directional accuracy is correct for long and short theses.
- Calibration curve reports absolute ECE and does not use bucket midpoint as
  the expected value.
- Brier score exists where binary outcome data exists.
- Valid neutral and unavailable/error factor states are distinguishable.
- Legacy API consumers can still read `confidence`.
- Documentation states V1 is not full empirical signal probability.

## Stop Rules

Stop and write a follow-up spec instead of expanding scope when:

- a change requires a new persistent observation table;
- factor outcomes need multi-horizon market labels;
- weight training or probability calibration is required;
- a public API field must be removed or renamed;
- fixing thesis-level reliability would require full factor attribution.
