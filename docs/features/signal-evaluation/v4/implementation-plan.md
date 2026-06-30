# Signal Evaluation V4 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V4.

Read this document first:
docs/features/signal-evaluation/v4/implementation-plan.md

Objective:
- Add walk-forward and out-of-sample signal metrics over V2 observations and V3
  outcome labels, including ECE, Brier, log loss, balanced accuracy, and
  breakdowns by regime, symbol, timeframe, horizon, and factor.
```

## One Outcome

Signal reliability reports can answer:

```text
How reliable was this factor/composite out of sample for a specific symbol,
horizon, timeframe, and market regime?
```

V4 reports measurement quality. It does not train or promote new weights.

## Non-Goals

- Do not train learned weights.
- Do not recalibrate production probabilities.
- Do not change SignalEngine scoring.
- Do not simulate trading execution or portfolio PnL.
- Do not use random splits for time-series metrics.

## Dependencies

V4 depends on:

- V2 `SignalObservation` rows;
- V3 `SignalOutcomeLabel` rows;
- label versions and observation versions being persisted;
- enough sample to form at least one completed OOS fold.

## Report Model

```python
class SignalEvaluationReport:
    id: str
    workspace_id: str
    report_version: str
    generated_at: datetime

    symbol: str | None
    factor_name: str | None
    factor_family: str | None
    horizon_minutes: int
    timeframe: str | None
    market_regime: str | None
    volatility_regime: str | None

    sample_size: int
    directional_sample_size: int
    oos_sample_size: int
    coverage_rate: float | None
    missing_rate: float | None
    stale_rate: float | None
    parse_failure_rate: float | None

    balanced_accuracy: float | None
    precision_bullish: float | None
    precision_bearish: float | None
    recall_bullish: float | None
    recall_bearish: float | None
    mcc: float | None

    spearman_ic: float | None
    rank_ic: float | None

    brier_score: float | None
    log_loss: float | None
    ece: float | None
    calibration_slope: float | None
    calibration_intercept: float | None

    mean_signed_return: float | None
    median_signed_return: float | None
    expectancy: float | None
    profit_factor: float | None
    average_mfe: float | None
    average_mae: float | None
    downside_deviation: float | None

    folds_json: dict
    buckets_json: dict
    breakdown_json: dict
    quality_warnings: list[str]
```

## Metric Inputs

Use only rows where:

```text
observation.availability = valid
outcome.label_status = complete
observation.observed_at < fold_test_start for training-derived statistics
```

Directional metrics use only bullish/bearish observations.

Coverage metrics use all observations, including missing/stale/parse_failed
rows, so data-health failures are visible.

## Walk-Forward Splits

Do not random split.

Default fold policy:

```text
train_window_days = 180
calibration_window_days = 30
test_window_days = 30
embargo_days = max_horizon_days
min_train_samples = 100
min_test_samples = 30
```

Example:

```text
Train:       Jan -> Jun
Calibration: Jul
Embargo:     horizon window
Test OOS:    Aug
```

Each next fold rolls forward by `test_window_days`.

If sample is too small:

- return `insufficient_data`;
- do not synthesize OOS metrics from in-sample rows;
- still report coverage and sample diagnostics.

## Purging And Embargo

Purging rule:

```text
Exclude training observations whose forward outcome window overlaps the test
period.
```

Embargo rule:

```text
Leave a gap of max(horizon_minutes) between calibration/train and test.
```

These rules matter because V3 labels use future windows.

## Probability Metrics

### Prediction Source

V4 can evaluate two probability-like inputs:

```text
heuristic_strength_as_score
empirical_probability if present and publishable
```

Rules:

- heuristic strength is treated as a score, not a calibrated probability;
- probability metrics using heuristic strength must be labeled
  `heuristic_score_calibration`;
- `empirical_probability` metrics require V5 or later probabilities and should
  be null if unavailable.

### ECE

Use bucket mean predicted value, not midpoint.

```text
bucket_error = abs(bucket_actual_rate - bucket_mean_predicted)
ece = sum(bucket_sample / total_sample * bucket_error)
```

### Brier Score

Binary outcome:

```text
outcome = 1 if direction_correct else 0
brier = mean((predicted_probability - outcome) ** 2)
```

If the input is heuristic strength, name the field:

```text
heuristic_brier_score
```

### Log Loss

Clip probabilities:

```text
p = min(max(p, 1e-6), 1 - 1e-6)
log_loss = -mean(outcome * log(p) + (1 - outcome) * log(1 - p))
```

Do not compute log loss for non-probability score unless explicitly labeled.

## Direction Metrics

Use balanced accuracy because class imbalance is expected.

```text
balanced_accuracy = (recall_positive + recall_negative) / 2
```

Also compute:

```text
precision
recall
MCC
confusion_matrix
```

Neutral/flat handling:

- bullish/bearish observations are directional samples;
- neutral observations are reported separately as no-edge samples;
- flat outcomes should not be counted as bullish or bearish wins unless the
  evaluated signal predicted neutral.

## Ranking Metrics

For each factor/composite:

```text
score = abs(directional_edge) or heuristic_strength
target = signed_return
```

Compute:

```text
Spearman IC
rank IC by day/week
```

Return null with `insufficient_sample` when too few rows exist.

## Breakdowns

Every report should support grouped metrics by:

```text
symbol
timeframe
horizon_minutes
factor_name
factor_family
market_regime
volatility_regime
calendar_month
provider
signal_weight_version
detector_version
```

V4 should not require every breakdown in the first UI. The API/report payload
must preserve them for later inspection.

## Report Persistence

Add persisted report snapshots:

```text
signal_evaluation_reports
```

Reports are append-only. Regenerating a report creates a new report row with a
new `generated_at` and report version.

Required indexes:

```text
workspace_id, generated_at
workspace_id, symbol, horizon_minutes, generated_at
workspace_id, factor_name, horizon_minutes, generated_at
```

## API Surface

```text
POST /signals/evaluation/reports
GET /signals/evaluation/reports
GET /signals/evaluation/reports/:id
GET /signals/evaluation/summary?symbol=&horizon=&factor=
```

Create request:

```ts
interface CreateSignalEvaluationReportRequest {
  symbol?: string;
  factor_name?: string;
  factor_family?: string;
  horizon_minutes: number;
  timeframe?: string;
  market_regime?: string;
  volatility_regime?: string;
  from?: string;
  to?: string;
  dry_run?: boolean;
}
```

Summary response:

```ts
interface SignalEvaluationSummaryResponse {
  generated_at: string;
  sample_size: number;
  oos_sample_size: number;
  coverage_rate: number | null;
  balanced_accuracy: number | null;
  ece: number | null;
  brier_score: number | null;
  log_loss: number | null;
  mean_signed_return: number | null;
  quality_warnings: string[];
  breakdowns: Record<string, unknown>;
}
```

## UI Scope

Add a minimal read-only report surface, or keep it API-only if UI capacity is
too high.

Minimum UI if implemented:

- report filters for symbol, horizon, factor;
- sample and OOS sample badges;
- data-health panel;
- directional metrics panel;
- calibration metrics panel;
- regime/symbol/factor breakdown table;
- warnings when metrics are in-sample-only or insufficient.

Required copy:

```text
Heuristic score calibration
Out-of-sample sample
Insufficient OOS data
Not a trading PnL result
```

## Required Tests

Metrics:

- ECE uses bucket mean prediction and absolute weighted error;
- Brier score matches deterministic fixture;
- log loss clips 0 and 1 safely;
- balanced accuracy handles imbalanced classes;
- MCC returns null or defined fallback when confusion matrix degenerates;
- ranking metrics return null for insufficient sample.

Walk-forward:

- folds are chronological;
- training rows overlapping test forward windows are purged;
- embargo gap is enforced;
- metrics are null when OOS sample is insufficient.

API:

- report creation is workspace-scoped;
- dry-run does not persist;
- list/detail endpoints return persisted snapshots;
- summary endpoint uses latest matching report.

## Validation Loop

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and metrics"
pnpm --filter @lunaperception/api test -- api-contract
pnpm --filter @lunaperception/web test -- signal
git diff --check
```

## Definition Of Done

- Signal reports aggregate V2 observations and V3 outcome labels only.
- Walk-forward folds are chronological and include purge/embargo rules.
- ECE, Brier, log loss, balanced accuracy, and data-health metrics are
  computed or explicitly null with warnings.
- Reports break down by symbol, horizon, factor, timeframe, and regime.
- Reports are persisted as append-only snapshots.
- No production weights or probabilities are changed by V4.

## Stop Rules

Stop and write a follow-up if:

- sample is too small for OOS folds;
- provider history is insufficient for requested horizons;
- implementing metrics would require changing V3 labels;
- learned weights or probability calibration enters the patch.
