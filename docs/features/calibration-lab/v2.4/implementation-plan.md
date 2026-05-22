# Calibration Lab V2.4 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.4 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.4/implementation-plan.md

Objective:
- Add an evaluation quality/confidence layer so Calibration Lab reports can show
  whether an evaluation result is well-supported by market data.

Required behavior:
- ThesisEvaluation and report rows expose data quality signals.
- Reports summarize low-quality and incomplete evaluations.
- Quality is deterministic and does not use LLMs.
```

## One Outcome

Make evaluation reliability visible.

V2.4 answers:

```text
Can I trust this evaluation result, or was the market data incomplete/stale?
```

## Quality Inputs

Use existing evidence when available:

```text
candle_count
first_candle_at
last_candle_at
start_price
end_price
highest_high
lowest_low
provider
warnings
```

If evidence is insufficient, update the Python evaluation engine to return
structured quality metadata.

## Quality Output

Per evaluation:

```json
{
  "quality_score": 0.82,
  "quality_label": "good",
  "quality_warnings": ["partial_ohlcv_window"],
  "provider": "binance",
  "expected_candle_count": 336,
  "actual_candle_count": 330,
  "coverage_pct": 0.982
}
```

Labels:

```text
good
partial
poor
unknown
```

## API Changes

Add quality fields to:

```text
CalibrationEvaluationResponse
SymbolCalibration rows/outcome summary
AgentCalibration supporting rows/coverage summary
Report snapshots
```

Do not change result semantics:

```text
hit_target remains hit_target
quality tells how trustworthy the evaluation is
```

## UI UX

Show:

```text
Quality badge
Coverage percent
Quality warnings
Low-quality count in reports
```

Copy:

```text
Evaluation quality
Data coverage
Low confidence result
```

Do not hide low-quality evaluations by default. Mark them clearly.

## Required Tests

- Quality score derives from evidence deterministically.
- Missing evidence produces unknown quality, not failure.
- Low candle coverage produces partial/poor labels.
- Symbol report summarizes low-quality evaluations.
- Agent report preserves quality fields in supporting rows.
- Existing result metrics remain unchanged.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Python validation if engine files change:

```bash
.venv\\Scripts\\python.exe -m pytest
```

## Stop Rules

Stop and report instead of expanding scope when:

- quality fields and summaries are present;
- engine evidence is insufficient and needs a separate engine task;
- implementation would require LLM judgment;
- implementation would require changing hit/invalidated scoring semantics.
