# Calibration Lab V2.3 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.3 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.3/implementation-plan.md

Objective:
- Add custom calibration ranges and longer evaluation/lookback windows behind
  explicit capability checks.

Required behavior:
- Reports can accept either preset lookback or explicit period_start/period_end.
- Longer evaluation windows such as 60d and 90d are available only when the
  engine/data layer supports them.
- UI exposes longer windows carefully and labels them as extended history.
```

## One Outcome

Support deeper historical calibration without breaking current preset behavior.

V2.3 answers:

```text
Can I evaluate longer horizons and custom historical periods when enough data is
available?
```

## Prerequisites

```text
V2.0 background jobs
V2.1 persisted snapshots
V2.2 trends
```

## API Changes

Extend report endpoints:

```text
GET /calibration/symbol
GET /calibration/agents
POST /calibration/reports/symbol
POST /calibration/reports/agents
```

Accepted filters:

```text
window_days=7|14|30|60|90
lookback_days=30|60|90|180|365
period_start=YYYY-MM-DD optional
period_end=YYYY-MM-DD optional
```

Validation:

```text
Use either lookback_days or period_start/period_end, not both.
period_start <= period_end.
period_end must be matured for window_days.
custom period max span is bounded.
```

## Capability Checks

Before enabling long windows:

```text
engine supports window_days
provider can fetch enough OHLCV
workspace/product entitlement allows extended history, if entitlement exists
```

If entitlement system is not implemented yet, expose a config flag rather than
hardcoding product logic.

## UI UX

Controls:

```text
Preset lookback
Custom range
Extended windows
```

Labels:

```text
Extended history
Requires enough market data
Incomplete data excluded
```

Do not add billing/paywall UI in V2.3 unless an entitlement system already
exists.

## Required Tests

- Preset behavior remains backward compatible.
- Custom range validation rejects future/unmatured ranges.
- Longer windows reject when capability is disabled.
- Longer windows work when capability is enabled.
- Symbol and Agent reports share period semantics.
- Snapshots store explicit custom ranges.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

## Stop Rules

Stop and report instead of expanding scope when:

- custom ranges and long windows work behind capability checks;
- entitlement/billing system is missing;
- provider or engine cannot support the requested windows;
- implementation would require LLM parsing or new scoring semantics.
