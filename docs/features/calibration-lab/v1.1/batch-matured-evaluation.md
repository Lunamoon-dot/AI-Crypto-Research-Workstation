# Calibration Lab V1.1 Batch Matured Evaluation

Last updated: 2026-05-21  
Status: deferred follow-up stub

## Purpose

Batch matured evaluation is intentionally deferred from Calibration Lab V1.
V1 must first prove the single-thesis path:

```text
select thesis -> evaluate -> persist ThesisEvaluation -> optionally record OutcomeReview
```

## Future Scope

Potential route:

```text
POST /calibration/evaluations/matured
```

Potential request fields:

- `window_days`
- `max_batch`
- optional symbol filter
- dry-run preview flag
- optional outcome-review recording, only after explicit confirmation

## Required Design Before Implementation

V1.1 needs decisions for:

- dry-run preview before writes;
- partial failures;
- provider rate limits;
- retry/backoff;
- per-row idempotency;
- skip reasons;
- max batch size;
- progress/status reporting;
- summary of created, existing, skipped, and failed evaluations.

## Non-Goals

- No scheduler/background loop.
- No historical replay UI.
- No trading/order execution.
- No broker PnL, Sharpe, alpha, or guaranteed-performance language.

## Dependency

Do not implement V1.1 until V1 is implemented and verified.

