# Calibration Lab

Calibration Lab is the workflow for evaluating saved trade theses against
forward market data and turning selected machine evaluations into official
outcome reviews.

The feature keeps two concepts separate:

```text
ThesisEvaluation = machine evaluation artifact
OutcomeReview    = journal review artifact used by reliability/performance views
```

## Versions

- [V1 Manual Single-Thesis Evaluation](v1/implementation-plan.md)
- [V1.1 Batch Matured Evaluation](v1.1/implementation-plan.md)
- [V1.2 Symbol Calibration MVP](v1.2/implementation-plan.md)
- [V1.3 Manual Single-Evaluation Rerun Audit](v1.3/implementation-plan.md)
- [V1.4 Agent Calibration MVP](v1.4/implementation-plan.md)
- [V1.5 Evaluation Version Policy](v1.5/implementation-plan.md)
- [V2.0 Background Evaluation Jobs](v2.0/implementation-plan.md)
- [V2.1 Persisted Calibration Report Snapshots](v2.1/implementation-plan.md)
- [V2.2 Historical Trends And Charts](v2.2/implementation-plan.md)
- [V2.3 Custom Ranges And Long Windows](v2.3/implementation-plan.md)
- [V2.4 Evaluation Quality Layer](v2.4/implementation-plan.md)
- [V2.5 Optional Cached Stance Parsing](v2.5/implementation-plan.md)
- [V3.0 Complete Calibration Workbench](v3.0/implementation-plan.md)

## Roadmap

```text
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP.
V1.5  Evaluation version policy and manual promotion.
V2.0  Background evaluation jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration report snapshots.
V2.2  Historical trends and charts.
V2.3  Custom ranges and long windows.
V2.4  Evaluation quality and confidence layer.
V2.5  Optional cached stance parsing.
V3.0  Complete Calibration Workbench polish.
```

## Product Boundary

Calibration Lab is research-quality evaluation. It is not broker PnL, a
trading simulator, automated execution, or a guarantee of future performance.
