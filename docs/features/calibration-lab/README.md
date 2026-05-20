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
- [V1.1 Batch Matured Evaluation](v1.1/batch-matured-evaluation.md)

## Product Boundary

Calibration Lab is research-quality evaluation. It is not broker PnL, a
trading simulator, automated execution, or a guarantee of future performance.

