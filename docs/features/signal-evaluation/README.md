# Signal Evaluation And Calibration

Signal Evaluation And Calibration is the product and engineering track for
turning the current deterministic signal layer into an auditable, empirically
evaluated probability system.

The feature keeps three concepts separate:

```text
Heuristic strength      = rule-derived evidence strength from SignalEngine
Signal observation      = immutable point-in-time factor/composite record
Empirical probability   = calibrated forward-outcome probability from OOS data
```

## Product Boundary

This feature evaluates market signal evidence. It does not replace Calibration
Lab, which evaluates saved theses and agent alignment after a maturity window.

Signal Evaluation owns:

- factor-level signal observation semantics;
- signal availability and data quality semantics;
- signal outcome labels by horizon;
- factor/composite reliability metrics;
- calibrated probability publication rules;
- signal weight training and monitoring when enough data exists.

Calibration Lab owns:

- thesis evaluation;
- official outcome reviews;
- agent and thesis-cluster calibration.

Neither feature is broker PnL, automated execution, or a guarantee of future
performance.

## Current Problem

The current signal stack is a deterministic evidence aggregator. It is useful,
but the word `confidence` is overloaded across:

- directional signal strength;
- detector certainty;
- data quality;
- thesis confidence;
- empirical forward-outcome probability.

The current UI and API still expose `confidence` as the primary number, even
though the runtime treats it as heuristic confidence and only publishes
empirical confidence when enough validated OOS sample exists. This can make a
neutral `8%` or `60%` look like a future probability when it is not.

## Versions

- [V1 Heuristic Signal Semantics And Correctness](v1/implementation-plan.md)
- [V2 Immutable Signal Observations](v2/implementation-plan.md)
- [V3 Multi-Horizon Outcome Labeler](v3/implementation-plan.md)
- [V4 Walk-Forward Metrics And OOS Reports](v4/implementation-plan.md)
- [V5 Learned Weights And Probability Calibration](v5/implementation-plan.md)
- [V6 Production Monitoring And Rollback](v6/implementation-plan.md)

## Roadmap

```text
V1  Heuristic signal semantics and correctness patch.
V2  Immutable SignalObservation records and availability status.
V3  Multi-horizon outcome labeler and point-in-time dataset builder.
V4  Walk-forward metrics, ECE, Brier, log loss, and report snapshots.
V5  Learned weights and calibrated probability shadow deployment.
V6  Production drift, provider degradation, parse-failure alerts, rollback.
```

## Full Implementation Order

If implementing the full feature in one branch, keep the runtime gates in this
order:

```text
1. V2 writes immutable observations without changing signal decisions.
2. V3 labels matured observations without changing signal decisions.
3. V4 reports OOS metrics without changing signal decisions.
4. V5 trains and shadows candidate weights/calibrators.
5. V5 promotes only when OOS gates pass.
6. V6 monitors promoted versions and can roll back to the last approved
   version.
```

Do not let later versions silently backfill missing earlier evidence. If V2/V3
data is insufficient, V4-V6 should report `insufficient_data` rather than
manufacturing metrics.

## First Code Areas To Inspect

```text
apps/ai-service/luna_workstation/signals/base.py
apps/ai-service/luna_workstation/signals/composite.py
apps/ai-service/luna_workstation/signals/engine.py
apps/ai-service/luna_workstation/signals/provenance.py
apps/ai-service/luna_workstation/signals/onchain_signals.py
apps/ai-service/luna_workstation/services/evaluation_service.py
apps/ai-service/luna_workstation/domain/calibration.py
apps/api/src/contracts/frontend-contract.ts
apps/web/src/pages/SignalsPage.tsx
apps/web/src/pages/SignalDetailPage.tsx
```
