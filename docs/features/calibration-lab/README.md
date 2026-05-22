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

## Roadmap

```text
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP.
V2.0  Background jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration reports / snapshots.
V2.x  Charts, historical replay, LLM stance parsing, and deeper analytics.
```

## Product Boundary

Calibration Lab is research-quality evaluation. It is not broker PnL, a
trading simulator, automated execution, or a guarantee of future performance.
