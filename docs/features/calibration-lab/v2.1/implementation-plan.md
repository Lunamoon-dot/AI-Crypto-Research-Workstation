# Calibration Lab V2.1 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.1 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.1/implementation-plan.md

Objective:
- Persist Symbol and Agent Calibration report snapshots so historical reports are
  reproducible even when evaluations, promotions, or source data later change.

Required behavior:
- Users can generate and save report snapshots.
- Scheduled/background workflows can save snapshots after evaluation jobs.
- Snapshots store request filters, generated_at, active evaluation policy
  metadata, coverage, metrics, verdicts, and compact rows.
- Existing read-time reports remain available.

Do not implement:
- Charts/trends.
- Custom date ranges.
- LLM stance parsing.
- New scoring semantics.
- Subscription/paywall logic.
```

## One Outcome

Make calibration reports reproducible.

V2.1 answers:

```text
What did the Symbol/Agent Calibration report say at the time it was generated?
```

## Prerequisites

```text
V1.2 Symbol Calibration
V1.4 Agent Calibration
V1.5 Active evaluation policy
V2.0 Background jobs
```

## Data Model

Add report snapshot tables:

```text
calibration_report_snapshots
- id
- workspace_id
- report_type              symbol | agent
- symbol nullable
- window_days
- lookback_days
- period_start
- period_end
- generated_at
- generated_by_user_id nullable
- source                   manual | job | scheduler
- source_job_id nullable
- active_policy_version nullable
- coverage_json
- metrics_json
- rows_json
- payload_json
```

Indexes:

```text
workspace_id, report_type, generated_at desc
workspace_id, report_type, symbol, window_days, lookback_days, generated_at desc
```

## API Contract

Generate and persist:

```text
POST /calibration/reports/symbol
POST /calibration/reports/agents
```

List snapshots:

```text
GET /calibration/reports?type=symbol&symbol=BTC%2FUSDT&limit=50
```

Get snapshot:

```text
GET /calibration/reports/:id
```

Read-time endpoints remain:

```text
GET /calibration/symbol
GET /calibration/agents
```

## Snapshot Rules

- Snapshot payload must include the exact report response used by the UI.
- Snapshot must store report type and filters outside JSON for queryability.
- Snapshot must record active evaluation policy metadata.
- Snapshot must not rerun evaluations.
- Snapshot must not mutate OutcomeReview.
- Snapshot must not include full source payloads unless already present in the
  report response.

## UI UX

Add to Symbol and Agent Calibration panels:

```text
Save snapshot
Latest saved snapshot
Open snapshot history
```

Add lightweight history table:

```text
Generated
Type
Symbol
Window
Lookback
Coverage
Verdict summary
Open
```

No charts in V2.1.

## Required Tests

- Saving a symbol report snapshot persists the exact report payload.
- Saving an agent report snapshot persists the exact report payload.
- Snapshot list is workspace scoped.
- Snapshot filters work by type/symbol/window/lookback.
- Snapshot get returns immutable payload.
- Scheduled/job source metadata is stored when provided.
- Read-time report endpoints still work without saving.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

## Stop Rules

Stop and report instead of expanding scope when:

- report snapshots are persisted and readable;
- implementation would require charts/trends;
- implementation would require custom date ranges;
- implementation would require new scoring semantics.
