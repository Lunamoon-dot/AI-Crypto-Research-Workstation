# Calibration Lab V2.0 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.0 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.0/implementation-plan.md

Objective:
- Move matured evaluation from synchronous/manual batch apply into durable
  background jobs with progress, retry, cancellation, and optional scheduled
  scanning.

Required behavior:
- Users can enqueue a matured evaluation job for a symbol/window.
- Jobs are workspace-scoped and durable.
- Jobs expose progress, row counts, successes, failures, and retry state.
- Jobs respect max batch limits and explicit user action.
- Scheduled scans can be enabled per workspace/config, but must stay bounded.
- Existing V1.1 preview/apply behavior remains usable.

Do not implement:
- Evaluation promotion policy changes.
- Persisted calibration report snapshots.
- Charts/trends.
- Long-window product gating.
- LLM stance parsing.
- Autonomous trading or broker execution.

Definition of done:
- A background matured evaluation job can run to completion and be inspected.
- Failed rows are visible and retryable.
- API tests cover queue/idempotency/progress/failure behavior.
```

## One Outcome

Make matured evaluation operationally reliable.

V2.0 answers:

```text
Can the system evaluate matured theses without keeping the browser request open,
and can I see what happened row by row?
```

## Prerequisites

```text
V1.1 Batch Matured Evaluation
V1.5 Evaluation Version Policy
```

V1.5 should come first so background jobs know which evaluation result is active.

## Scope

Add durable job workflow for matured thesis evaluation:

```text
preview -> enqueue job -> worker processes candidates -> progress/read result
```

Job source:

```text
symbol optional
window_days 7/14/30
scan_limit bounded
max_batch bounded
```

## API Contract

Preview stays:

```text
POST /calibration/evaluations/matured/preview
```

New job endpoints:

```text
POST /calibration/evaluations/matured/jobs
GET  /calibration/evaluations/matured/jobs/:job_id
POST /calibration/evaluations/matured/jobs/:job_id/cancel
POST /calibration/evaluations/matured/jobs/:job_id/retry
```

Optional scheduler endpoints:

```text
GET   /calibration/scheduler
PATCH /calibration/scheduler
POST  /calibration/scheduler/run-once
```

## Job State

Required status values:

```text
queued
running
completed
failed
cancelled
dead_letter
```

Progress fields:

```text
candidate_count
processed_count
created_count
existing_count
skipped_count
failed_count
started_at
completed_at
error_type
error_message
rows
```

Row result:

```text
thesis_id
symbol
window_days
status
evaluation_id
result
warnings
message
```

## Data Model

Prefer reusing existing durable job infrastructure if it can support calibration
jobs cleanly.

If reuse is awkward, add calibration-specific tables:

```text
calibration_jobs
calibration_job_rows
```

Do not overload monitoring pulse jobs if doing so makes operations confusing.

## Idempotency

Job creation should accept optional `idempotency_key`.

When provided:

```text
same workspace + idempotency_key -> return existing job
```

Scheduler-generated jobs must use deterministic keys:

```text
calibration:matured:<workspace>:<date>:<window>:<symbol-or-all>
```

## Worker Rules

- Process one candidate at a time.
- Respect cancellation between rows.
- Persist row-level failure without failing the entire job immediately.
- Retry only failed rows unless explicitly configured otherwise.
- Keep max attempts bounded.
- Never auto-promote reruns.
- Never create OutcomeReview.

## UI UX

In `/calibration?mode=batch`:

```text
Preview matured rows
Run in background
Job progress panel
Row result table
Retry failed
Cancel running job
```

Optional scheduler panel:

```text
enabled toggle
window_days
symbol optional
max_batch
next_run_at
last_run summary
```

## Required Tests

- Job creation is workspace scoped.
- Duplicate idempotency key returns existing job.
- Worker creates evaluations for candidates.
- Existing evaluations are reported as existing.
- Row failures do not hide successful rows.
- Cancellation stops before next row.
- Retry processes failed rows only.
- Scheduler run-once enqueues bounded job.
- Viewer cannot enqueue/cancel/retry jobs.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Preview batch candidates.
- Enqueue a background job.
- Watch progress update.
- Confirm result rows match created evaluations.
- Retry failed rows if fixture/environment allows.

## Stop Rules

Stop and report instead of expanding scope when:

- durable matured evaluation jobs work;
- implementing requires report snapshots, charts, or subscriptions;
- scheduler requires external infra not present locally;
- worker semantics conflict with existing job architecture.
