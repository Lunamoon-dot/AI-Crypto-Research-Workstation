# Signal Evaluation V6 Implementation Plan

Last updated: 2026-06-30
Status: draft

## Goal-Ready Prompt

```text
/goal Implement Signal Evaluation V6.

Read this document first:
docs/features/signal-evaluation/v6/implementation-plan.md

Objective:
- Add production monitoring, drift detection, provider degradation alerts,
  calibration health checks, and rollback controls for promoted signal model
  versions.
```

## One Outcome

After a V5 model is promoted, the system can answer:

```text
Is the promoted signal model still healthy, calibrated, and supported by
current data quality?
```

V6 keeps promoted models operationally safe. It does not train new models.

## Non-Goals

- Do not train weights.
- Do not auto-tune thresholds.
- Do not auto-promote new versions.
- Do not execute trades.
- Do not hide degraded model output without recording why.

## Dependencies

V6 requires:

- V2 observations;
- V3 labels for matured windows;
- V4 report metrics;
- V5 promoted weight/calibrator versions;
- a stable job runner or scheduled task mechanism.

If V5 has no promoted model, V6 should still monitor data health and heuristic
signal availability, but model drift fields should be null.

## Monitoring Domains

### Data Health

Track:

```text
coverage_rate
missing_rate
stale_rate
parse_failure_rate
provider_error_rate
valid_factor_count
```

Break down by:

```text
symbol
provider
factor_name
factor_family
timeframe
horizon_minutes
```

### Feature Drift

Compare recent feature distributions to the training baseline.

Metrics:

```text
PSI
KS statistic
mean/std shift
missingness shift
```

Default windows:

```text
recent_window_days = 7
baseline = training feature stats from promoted weight version
```

### Calibration Drift

For matured labels only:

```text
rolling_ece
rolling_brier
rolling_log_loss
rolling_balanced_accuracy
```

Use the same horizon as the promoted calibrator. Do not evaluate unmatured
predictions.

### Prediction Health

Track:

```text
probability_distribution
probability_mean
probability_std
publishable_rate
null_probability_rate
model_score_distribution
```

Alert if probabilities collapse to a narrow range or become unavailable.

### Version Health

Track:

```text
active_weight_version
active_calibrator_version
last_promotion_at
last_rollback_at
shadow_versions
retired_versions
```

## Alert Types

```text
provider_degraded
parse_failure_spike
stale_data_spike
feature_drift_warning
feature_drift_critical
calibration_drift_warning
calibration_drift_critical
oos_performance_regression
probability_unavailable_spike
model_version_missing
rollback_recommended
rollback_executed
```

Severity:

```text
info
warning
critical
```

## Monitoring Snapshot Model

```python
class SignalModelMonitoringSnapshot:
    id: str
    workspace_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime

    active_weight_version: str | None
    active_calibrator_version: str | None
    horizon_minutes: int | None

    observation_count: int
    matured_label_count: int
    publishable_prediction_count: int

    data_health_json: dict
    feature_drift_json: dict
    calibration_health_json: dict
    prediction_health_json: dict
    breakdown_json: dict
    alerts_json: list[dict]
    status: Literal["healthy", "degraded", "critical", "insufficient_data"]
```

## Alert Model

```python
class SignalModelAlert:
    id: str
    workspace_id: str
    alert_type: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["open", "acknowledged", "resolved"]
    active_weight_version: str | None
    active_calibrator_version: str | None
    symbol: str | None
    factor_name: str | None
    message: str
    evidence_json: dict
    created_at: datetime
    acknowledged_at: datetime | None
    resolved_at: datetime | None
```

## Rollback Model

```python
class SignalModelRollback:
    id: str
    workspace_id: str
    from_weight_version: str
    to_weight_version: str
    from_calibrator_version: str
    to_calibrator_version: str
    reason: str
    evidence_snapshot_id: str
    requested_by: str
    executed_at: datetime
```

Rollback rules:

- rollback only to a previously promoted version;
- keep all candidate/shadow artifacts unchanged;
- record the alert or monitoring snapshot that justified rollback;
- after rollback, runtime uses the prior promoted version immediately;
- never delete the rolled-back version.

## Threshold Policy

Default warning thresholds:

```text
parse_failure_rate > baseline + 5 percentage points
stale_rate > baseline + 10 percentage points
PSI > 0.20
rolling_ece > baseline_ece + 0.03
rolling_brier > baseline_brier + 0.02
publishable_rate < 80%
```

Default critical thresholds:

```text
parse_failure_rate > baseline + 15 percentage points
PSI > 0.35
rolling_ece > baseline_ece + 0.06
rolling_brier > baseline_brier + 0.04
publishable_rate < 50%
model_version_missing = true
```

Thresholds must be versioned in monitoring policy metadata.

## Job Flow

```text
scheduled monitoring job
        |
        v
load active model versions
        |
        v
load recent observations, predictions, and matured labels
        |
        v
compute data health, drift, calibration, prediction health
        |
        v
persist monitoring snapshot
        |
        v
open or update alerts
        |
        v
optionally recommend rollback
```

Rollback remains manual unless a future policy explicitly enables automatic
rollback.

## API Surface

```text
GET /signals/models/monitoring/latest
GET /signals/models/monitoring/snapshots
GET /signals/models/monitoring/snapshots/:id
GET /signals/models/alerts
PATCH /signals/models/alerts/:id
POST /signals/models/rollbacks
GET /signals/models/rollbacks
```

Alert patch:

```ts
interface UpdateSignalModelAlertRequest {
  status: 'acknowledged' | 'resolved';
  note?: string;
}
```

Rollback request:

```ts
interface RollbackSignalModelRequest {
  to_weight_version: string;
  to_calibrator_version: string;
  reason: string;
  evidence_snapshot_id: string;
}
```

## UI Scope

Minimum UI:

- active model/version banner;
- monitoring status badge;
- data health cards;
- drift and calibration trend panels;
- open alerts table;
- rollback action for critical alerts;
- latest monitoring snapshot raw JSON.

Required copy:

```text
Model health
Calibration drift
Feature drift
Provider degradation
Rollback to previous promoted version
```

Do not use trading PnL wording.

## Required Tests

Monitoring:

- data-health snapshot handles no promoted model;
- PSI/KS drift flags warning and critical thresholds;
- rolling calibration metrics use only matured labels;
- alert deduplication avoids opening duplicates every run;
- resolved alerts can reopen if degradation returns.

Rollback:

- rollback rejects never-promoted versions;
- rollback records evidence snapshot and reason;
- active runtime version changes to rollback target;
- rolled-back version remains queryable.

API/UI:

- endpoints are workspace-scoped;
- latest monitoring endpoint returns `insufficient_data` when sample is small;
- alert status patch validates transitions;
- UI distinguishes warning and critical alerts.

## Validation Loop

```bash
node scripts/python.cjs -m pytest apps/ai-service/tests -k "signal and monitoring"
pnpm --filter @lunaperception/api test -- api-contract
pnpm --filter @lunaperception/web test -- signal
git diff --check
```

## Definition Of Done

- Monitoring snapshots are persisted on schedule or manual trigger.
- Data health, feature drift, calibration drift, and prediction health are
  reported by active model version.
- Alerts are created, acknowledged, resolved, and reopened deterministically.
- Rollback can switch to a previous promoted version with audit evidence.
- No new model is trained or promoted by V6 monitoring.

## Blockers To Resolve Before Implementation

- Confirm the project job runner to use for recurring monitoring.
- Confirm alert storage should live in API Postgres, local journal, or both.
- Confirm who can execute rollback in workspace auth.
- Confirm minimum sample windows for each horizon before alerts become active.
- Confirm UI placement: Signals page, Operations page, or a new model health
  page.

## Stop Rules

Stop and write a follow-up if:

- promoted V5 artifacts do not exist and model-specific monitoring is requested;
- monitoring needs external alert integrations not present in the repo;
- automatic rollback is required;
- rollback would require deleting or mutating historical model artifacts.
