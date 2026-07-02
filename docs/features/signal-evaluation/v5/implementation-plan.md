# Signal Evaluation V5 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V5.

Read this document first:
docs/features/signal-evaluation/v5/implementation-plan.md

Objective:
- Train versioned signal weights and probability calibrators from V2
  observations, V3 outcome labels, and V4 walk-forward/OOS reports. Deploy
  candidates in shadow mode first, and promote only when objective gates pass.
```

## One Outcome

The system can produce a candidate empirical probability such as:

```text
P(up, 24h) = 61%
weight_version = signal_weights:v2:2026-07-xx
calibrator_version = signal_calibrator:v1:2026-07-xx
OOS n = 842
ECE = 3.7%
Brier = 0.218
```

V5 turns measured signal behavior into learned weights and calibrated
probabilities. It must not replace production behavior until promotion gates
pass.

## Non-Goals

- Do not train neural networks.
- Do not optimize for broker PnL.
- Do not bypass V4 walk-forward/OOS metrics.
- Do not auto-promote a candidate without explicit policy approval.
- Do not remove heuristic SignalEngine scoring.
- Do not publish probability when sample gates fail.

## Dependencies

V5 requires:

- V2 `SignalObservation` rows;
- V3 `SignalOutcomeLabel` rows;
- V4 report/fold builder with purge and embargo;
- at least one eligible OOS fold for the target horizon;
- versioned label, weight, threshold, and detector metadata.

If any dependency is missing, V5 must return `insufficient_data`.

## Training Target

V5 starts with binary directional targets.

```text
target = 1 if signal direction was correct
target = 0 if signal direction was incorrect
```

Eligible rows:

```text
observation.availability = valid
outcome.label_status = complete
observation.direction in bullish, bearish
```

Future versions may add multiclass `P(up), P(flat), P(down)`, but V5 should keep
the first production candidate binary by horizon to reduce complexity.

## Feature Set

Build features from observations and labels without reading thesis text.

Base features:

```text
rsi_edge
macd_edge
volume_edge
regime_edge
funding_oi_edge
liquidation_edge
market_structure_proxy_edge

rsi_quality
macd_quality
volume_quality
regime_quality
funding_oi_quality
liquidation_quality
market_structure_proxy_quality

is_trending
is_ranging
is_high_vol
is_extreme_vol

valid_factor_count
missing_factor_count
parse_failed_factor_count
```

Interaction features:

```text
rsi_edge:is_ranging
macd_edge:is_trending
funding_oi_edge:is_high_vol
liquidation_edge:is_high_vol
volume_edge:is_trending
```

Family caps:

```text
price_momentum max total contribution
price_structure max total contribution
volume max total contribution
derivatives max total contribution
market_structure_proxy max total contribution
```

The model should not treat correlated OHLCV-derived factors as independent
sources of truth.

## Model

Initial model:

```text
regularized logistic regression
penalty = L2 by default
optional L1 for feature selection when sample is large enough
```

Training policy:

```text
train on train fold
fit calibrator on calibration fold
evaluate on test OOS fold
aggregate OOS metrics across folds
```

Do not use test folds to tune weights, thresholds, or calibrator method.

## Calibration

Supported calibrators:

```text
platt      = default for smaller samples
isotonic   = allowed when calibration sample is large enough
beta       = optional for probability mass near 0 or 1
none       = allowed only for diagnostic baseline
```

Default gates:

```text
min_train_samples = 500
min_calibration_samples = 150
min_oos_samples = 150
min_folds = 3
```

If gates fail, store a diagnostic report but mark:

```text
publishable = false
reason = insufficient_data
```

## Artifact Models

### Signal Weight Version

```python
class SignalWeightVersion:
    id: str
    workspace_id: str
    version: str
    status: Literal["candidate", "shadow", "promoted", "retired", "rejected"]
    horizon_minutes: int
    timeframe: str
    model_type: str
    feature_schema_version: str
    label_version: str
    training_window_start: datetime
    training_window_end: datetime
    weights_json: dict
    feature_stats_json: dict
    fold_metrics_json: dict
    oos_metrics_json: dict
    created_at: datetime
    promoted_at: datetime | None
```

### Signal Calibrator Version

```python
class SignalCalibratorVersion:
    id: str
    workspace_id: str
    version: str
    weight_version: str
    status: Literal["candidate", "shadow", "promoted", "retired", "rejected"]
    horizon_minutes: int
    method: Literal["platt", "isotonic", "beta", "none"]
    params_json: dict
    calibration_metrics_json: dict
    sample_size: int
    oos_sample_size: int
    publishable: bool
    created_at: datetime
    promoted_at: datetime | None
```

### Signal Model Promotion

```python
class SignalModelPromotion:
    id: str
    workspace_id: str
    from_weight_version: str | None
    to_weight_version: str
    from_calibrator_version: str | None
    to_calibrator_version: str
    promoted_by: str
    promoted_at: datetime
    policy_json: dict
    evidence_report_id: str
```

## Suggested Files

```text
apps/ai-service/luna_workstation/signals/training/dataset.py
apps/ai-service/luna_workstation/signals/training/features.py
apps/ai-service/luna_workstation/signals/training/trainer.py
apps/ai-service/luna_workstation/signals/training/registry.py
apps/ai-service/luna_workstation/signals/calibration/calibrator.py
apps/ai-service/luna_workstation/signals/calibration/platt.py
apps/ai-service/luna_workstation/signals/calibration/isotonic.py
apps/ai-service/luna_workstation/signals/calibration/beta.py
apps/ai-service/luna_workstation/signals/calibration/validation.py
```

## Runtime Shape

V5 adds a shadow scoring path after the current heuristic result.

```text
SignalEngine heuristic output
        |
        v
SignalObservation rows
        |
        v
shadow learned scorer, if promoted/candidate model is configured
        |
        v
candidate model_score and calibrated_probability persisted as metadata
```

Runtime fields:

```json
{
  "heuristic_strength": 0.64,
  "model_score": 0.71,
  "empirical_probability": 0.61,
  "probability_horizon_minutes": 1440,
  "weight_version": "signal_weights:v2:2026-07-xx",
  "calibrator_version": "signal_calibrator:v1:2026-07-xx",
  "probability_publishable": true,
  "oos_sample_size": 842
}
```

If not publishable:

```json
{
  "empirical_probability": null,
  "probability_publishable": false,
  "probability_unavailable_reason": "insufficient_oos_sample"
}
```

## Promotion Gates

A candidate can be promoted only when:

```text
oos_sample_size >= min_oos_samples
fold_count >= min_folds
ece <= baseline_ece - min_ece_improvement
brier <= baseline_brier - min_brier_improvement
log_loss <= baseline_log_loss + allowed_log_loss_tolerance
balanced_accuracy >= baseline_balanced_accuracy
no critical symbol/regime breakdown regresses beyond tolerance
```

Default tolerances:

```text
min_ece_improvement = 0.01
min_brier_improvement = 0.005
allowed_log_loss_tolerance = 0.01
max_breakdown_regression = 0.03
```

Promotion should be explicit:

```text
POST /signals/models/promotions
```

Do not auto-promote from a training job.

## API Surface

```text
POST /signals/models/train
GET /signals/models/weights
GET /signals/models/weights/:version
GET /signals/models/calibrators
GET /signals/models/calibrators/:version
POST /signals/models/promotions
GET /signals/models/promotions
```

Training request:

```ts
interface TrainSignalModelRequest {
  horizon_minutes: number;
  symbol?: string;
  timeframe?: string;
  factor_family?: string;
  from?: string;
  to?: string;
  model_type?: 'logistic_regression_l2' | 'logistic_regression_l1';
  calibrator?: 'platt' | 'isotonic' | 'beta';
  dry_run?: boolean;
}
```

Promotion request:

```ts
interface PromoteSignalModelRequest {
  weight_version: string;
  calibrator_version: string;
  evidence_report_id: string;
  policy_override_reason?: string;
}
```

## UI Scope

Minimum UI:

- candidate version list;
- OOS gate pass/fail badges;
- baseline vs candidate metrics;
- feature weight table;
- calibration curve;
- promote/reject action with confirmation;
- clear `shadow` vs `promoted` status.

Do not surface a candidate probability as the main Signal UI probability until
the candidate is promoted and publishable.

## Required Tests

Training:

- feature builder produces stable columns and handles missing factors;
- train/calibration/test folds are chronological;
- purge and embargo are inherited from V4;
- training fails closed when sample gates fail;
- model artifact is deterministic for a fixed fixture.

Calibration:

- Platt calibrator maps raw scores to bounded probabilities;
- isotonic is rejected when sample is below threshold;
- Brier/ECE/log loss are computed on OOS only;
- unpublishable calibrator returns null probability.

Promotion:

- candidate cannot be promoted when gates fail;
- promotion records policy and evidence report id;
- promoted version becomes the active runtime version;
- previous promoted version remains available for rollback.

API/UI:

- legacy heuristic signal output remains available;
- candidate model fields appear only when configured;
- UI distinguishes candidate, shadow, promoted, retired, and rejected.

## Validation Loop

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and training"
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and calibration"
pnpm --filter @lunaperception/api test -- api-contract
pnpm --filter @lunaperception/web test -- signal
git diff --check
```

## Definition Of Done

- Learned weight and calibrator artifacts are versioned and persisted.
- Training uses V4 folds, purge, embargo, and OOS metrics.
- Candidate probabilities run in shadow mode before promotion.
- Promotion is explicit and gate-checked.
- Runtime can emit publishable empirical probability only for promoted,
  publishable calibrators.
- Heuristic SignalEngine behavior remains available as fallback.

## Blockers To Resolve Before Implementation

- Confirm enough V2/V3 data exists for each target horizon.
- Confirm provider history supports requested horizon labels.
- Decide whether V5 is workspace-local or global across workspaces.
- Decide where model artifacts live: database JSON, filesystem artifact, or
  both.
- Confirm whether `scikit-learn` or a local lightweight implementation is the
  preferred training dependency.

## Stop Rules

Stop and write a follow-up if:

- sample gates fail for all horizons;
- model artifacts cannot be persisted version-safely;
- promotion would require changing public API semantics;
- learned weights start affecting production before shadow evaluation exists.
