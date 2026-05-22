# Calibration Lab V2.2 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.2 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.2/implementation-plan.md

Objective:
- Add historical trend APIs and UI charts for persisted Calibration Lab report
  snapshots.

Required behavior:
- Trends are computed from V2.1 persisted snapshots.
- Symbol and Agent Calibration can show historical coverage and verdict trends.
- Charts are read-only.
- No scoring semantics change.
```

## One Outcome

Turn saved calibration snapshots into historical trends.

V2.2 answers:

```text
Is reliability improving or degrading over time?
```

## Prerequisites

```text
V2.1 persisted report snapshots
```

## API Contract

Trend endpoints:

```text
GET /calibration/trends/symbol?symbol=BTC%2FUSDT&window_days=7&lookback_days=30
GET /calibration/trends/agents?window_days=7&lookback_days=30&agent_role=market
```

Response shape:

```json
{
  "series": [
    {
      "generated_at": "2026-05-22T00:00:00.000Z",
      "coverage_pct": 0.75,
      "hit_rate": 0.56,
      "alignment_success_rate": null,
      "verdict": "correct"
    }
  ],
  "summary": {
    "point_count": 12,
    "latest_verdict": "correct",
    "coverage_delta": 0.12
  }
}
```

## Charts

Add lightweight charts:

```text
Coverage over time
Hit/invalidation or alignment trend
Verdict timeline
Missing evaluation count
```

Keep charts compact. Do not build a separate analytics product in V2.2.

## UI UX

Add trend sections inside existing report modes:

```text
/calibration?mode=symbol
/calibration?mode=agents
```

Optional tab:

```text
Current report | Snapshot history | Trends
```

No standalone route required unless existing layout becomes cramped.

## Data Rules

- Use snapshots only.
- Do not recompute old reports from current evaluations.
- Do not fill gaps with inferred data.
- Show empty state when fewer than two snapshots exist.

## Required Tests

- Trend endpoints are workspace scoped.
- Trends are sorted by generated_at ascending.
- Symbol trend filters by symbol/window/lookback.
- Agent trend filters by role/window/lookback.
- Empty trend returns stable empty response.
- UI typecheck passes.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

## Stop Rules

Stop and report instead of expanding scope when:

- snapshot trends and basic charts work;
- implementation would require new evaluation semantics;
- implementation would require LLM parsing;
- implementation would require subscription/paywall work.
