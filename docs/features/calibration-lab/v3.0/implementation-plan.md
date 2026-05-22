# Calibration Lab V3.0 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V3.0 end-to-end.

Read this document first:
docs/features/calibration-lab/v3.0/implementation-plan.md

Objective:
- Polish Calibration Lab into a complete reliability workbench that integrates
  evaluation jobs, active version policy, symbol/agent reports, snapshots,
  trends, quality warnings, exports, and clear research-quality language.

Required behavior:
- Existing workflows remain discoverable and consistent.
- The workbench has clear current state, history, and action paths.
- Reports can be shared/exported without losing context.
- Operational status and data quality are visible.
- Product copy avoids PnL or trading guarantee claims.
```

## One Outcome

Finish Calibration Lab as a coherent product surface.

V3.0 answers:

```text
Can a user operate, audit, and explain the reliability layer from one place?
```

## Prerequisites

```text
V1.5 active evaluation policy
V2.0 background jobs
V2.1 persisted snapshots
V2.2 trends
V2.3 custom ranges/long windows
V2.4 quality layer
V2.5 optional cached stance parsing
```

## Product Surface

Unify Calibration Lab modes:

```text
Single Thesis
Batch Matured
Symbol Calibration
Agent Calibration
Reports
Trends
Operations
```

Keep the route under:

```text
/calibration
```

Only add subroutes if the single page becomes too dense:

```text
/calibration/reports/:id
/calibration/jobs/:id
```

## Required Capabilities

Current state:

```text
pending matured evaluations
running jobs
latest symbol reports
latest agent reports
low-quality evaluations
unknown stance backlog
```

History:

```text
evaluation history
rerun audit
promotion audit
report snapshots
trend charts
job history
```

Actions:

```text
evaluate thesis
enqueue matured job
rerun audit
promote/reset active evaluation
save report snapshot
parse/review unknown stance
export report
```

## Export/Share

Add export for saved snapshots:

```text
JSON
CSV for table rows
Markdown summary
```

Do not export secrets, raw provider credentials, or full LLM prompts unless
explicitly intended and scrubbed.

## Operations

Expose health/status:

```text
last scheduler run
failed jobs
provider/data quality warnings
LLM parse queue status
snapshot freshness
coverage gaps
```

## UX Rules

- Dense, operational UI.
- No marketing hero.
- No claims of guaranteed performance.
- Use "research-quality", "alignment proxy", "evaluation quality", and
  "coverage" language.
- Every metric should have a visible denominator or coverage cue.
- Every write action should have explicit confirmation when it changes active
  policy or creates jobs.

## Hard Non-Goals

- Autonomous trading.
- Broker PnL.
- Trade execution.
- Hidden automatic promotion.
- Report-time LLM calls.
- Unbounded background jobs.

## Required Tests

- Main Calibration Lab modes render.
- Existing single/batch/symbol/agent workflows remain functional.
- Reports and trends link to snapshots correctly.
- Export outputs include required context.
- Operations panel shows failed jobs and coverage gaps.
- Permission tests cover viewer/editor boundaries.
- Copy does not include banned overclaiming terms.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Walk through every Calibration Lab mode.
- Create or inspect a background job.
- Save and open a report snapshot.
- Open trend view.
- Export a report.
- Confirm low-quality/unknown stance states are visible.

## Completion Criteria

Calibration Lab can be considered feature-complete when:

```text
automatic matured evaluation exists
manual and scheduled workflows are auditable
active evaluation version policy exists
rerun audit and promotion/reset exist
symbol calibration exists
agent calibration exists
persisted report snapshots exist
historical trends exist
quality warnings exist
optional cached stance parsing exists
exports exist
copy avoids PnL/autonomous trading claims
tests cover read/write/permission/edge cases
```

## Stop Rules

Stop and report instead of expanding scope when:

- the workbench integrates existing completed capabilities cleanly;
- implementation would require broker integration;
- implementation would require autonomous trade execution;
- product/entitlement decisions are missing;
- visual complexity would require a separate design pass.
