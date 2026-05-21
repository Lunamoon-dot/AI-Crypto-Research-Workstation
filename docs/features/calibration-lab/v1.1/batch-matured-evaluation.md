# Calibration Lab V1.1 Batch Matured Evaluation Stub

Last updated: 2026-05-21  
Status: superseded by goal-ready plan

The goal-ready implementation plan now lives at:

```text
docs/features/calibration-lab/v1.1/implementation-plan.md
```

## Purpose

Batch matured evaluation was intentionally deferred from Calibration Lab V1.
V1 proved the single-thesis path:

```text
select thesis -> evaluate -> persist ThesisEvaluation -> optionally record OutcomeReview
```

## Current Scope

Use `implementation-plan.md` for the source of truth. The V1.1 scope is:

```text
preview matured theses -> explicit bounded apply -> create/reuse ThesisEvaluation
```

## Non-Goals

- No automatic OutcomeReview recording.
- No force rerun/re-evaluate policy.
- No scheduler/background loop.
- No historical replay UI.
- No trading/order execution.
- No broker PnL, Sharpe, alpha, or guaranteed-performance language.
