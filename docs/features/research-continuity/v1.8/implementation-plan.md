# Research Continuity V1.8 Automated Scheduled Repair Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the V1.7 manual scheduled repair path into a safe background worker with Postgres lease/claim, idempotent execution, failure backoff, and operations visibility.

**Architecture:** V1.8 adds a separate API-package worker process that polls due workspace scheduler settings, claims work through Postgres lease fields, and invokes an internal scheduled repair service path. The worker does not run new research; it repairs or records continuity artifacts for already completed research runs by reusing the V1.6 repair history and V1.7 scheduler settings. Failures are recorded on workspace settings and surfaced through operations health so automation can be trusted before broader V2 continuity work.

**Tech Stack:** NestJS service layer, TypeScript worker entry point, Postgres SQL schema, Prisma schema metadata, existing Research Continuity audit/settings repositories, existing Research Continuity and Operations pages, Node test runner, pnpm scripts.

---

Last updated: 2026-05-30
Status: implemented

## One Outcome

V1.8 should let Research Continuity scheduled repair run automatically without an operator clicking `Run due repair`, while preserving the same safety properties as V1.7:

```text
continuity scheduler worker starts
  -> polls due workspace repair settings
  -> claims due workspace rows with a short DB lease
  -> runs the existing scheduled repair logic as a system actor
  -> records durable repair history
  -> advances next due time only after completed repair history
  -> records errors and backoff after failures
  -> reports worker health in operations
```

This is a hardening and operationalization version. It is not a new research
feature, report feature, or diff-view feature. Treat V1.8 as a controlled
refactor around V1.7 scheduled repair execution plus the minimum operational
metadata required to run that path safely in a separate process.

## Why Failures Can Happen

Scheduled repair does not happen while the Python research engine is producing the original research result. By the time V1.8 runs, research has already produced completed run artifacts.

The worker still performs real work:

```text
read workspace scheduler settings
read completed research runs in the repair lookback window
read existing continuity entries and continuity state
discover missing, degraded, skipped, or legacy continuity cases
create durable repair run audit rows
optionally create repair continuity entries
optionally update continuity state
mark the scheduler due time forward
write scheduler attempt/error metadata
```

Failures are checked at the automation boundary, not as "research correctness" checks.

Examples:

- Postgres is unavailable or a continuity table is missing.
- A repair run audit row cannot be created, so mutation must not start.
- A legacy entry payload has an unexpected shape and cannot be rebuilt safely.
- Another worker already claimed the workspace or started the same idempotent repair.
- A repair run exists for the same due key but is `started` or `failed`, so due time must not advance.
- The process crashes after repair history is created but before scheduler settings are marked forward.
- A normal continuity entry appears between preview/discovery and repair execution.
- A schema or contract drift causes generated repair response mapping to fail.

V1.8 should catch these failures around each claimed workspace run. It should record:

```text
last_scheduler_attempt_at
last_scheduler_success_at
last_scheduler_error
consecutive_scheduler_failures
next_scheduler_retry_at
```

It should not advance `next_scheduled_repair_due_at` on failure.

## Product Decisions

- V1.8 remains part of Research Continuity.
- Scope is locked to automated scheduled repair worker hardening.
- V1.8 is an operational hardening/refactor release. Do not change snapshot
  extraction, delta/diff semantics, repair candidate semantics, report
  rendering, or the user-facing research workflow unless a change is required
  to make the worker safe.
- The worker is a separate process in the API package.
- Production does not require Docker. Docker Compose can wire the process for local or self-host smoke, but the runtime requirement is a separate process, not a container.
- The API web server must not start the scheduler with in-process `setInterval`.
- The worker uses polling plus Postgres lease/claim.
- The worker handles claimed workspace rows sequentially inside each batch. Do
  not use `Promise.all` or configurable concurrency in V1.8.
- The worker uses a system actor, not a browser user, for scheduled repair audit attribution.
- The existing manual `POST /research-continuity/scheduler/run-due` remains available.
- The existing V1.7 settings UI remains the operator control surface.
- The default worker batch size is `1` because claimed rows are processed
  sequentially under a fixed lease. Only increase batch size together with a
  lease duration sized for the worst-case sequential repair time.
- Manual run-due must not bypass an active worker lease. If a worker lease is still
  valid, the manual endpoint returns `skipped_reason: 'worker_lease_active'`.
  Do not add a force-run or force-unlock option in V1.8.
- For worker runs, `markSchedulerSuccess()` is the only writer that advances
  `next_scheduled_repair_due_at`, and it must be guarded by
  `scheduler_lease_owner = worker_id`. The internal repair method may compute
  the next due time for the worker, but it must not persist that advancement
  when `source: 'worker'`.
- `next_scheduled_repair_due_at = null` means due now for active modes
  (`dry_run` or `enabled`) and never due for `disabled`.
- A completed idempotent repair replay after a worker crash is scheduler
  success. `completed` and `completed_with_failures` both advance scheduler
  due time through `markSchedulerSuccess()`.
- `completed_with_failures` is repair-domain partial failure, not scheduler
  automation failure. It must not set `last_scheduler_error` or increment
  `consecutive_scheduler_failures`; operators can inspect the linked repair run
  status for candidate-level failures.
- Failure retry uses exponential backoff with a cap:
  - 1st failure: retry after 5 minutes.
  - 2nd failure: retry after 15 minutes.
  - 3rd failure: retry after 1 hour.
  - 4th and later failures: retry after 6 hours.
- Manual run-due can still run when an operator needs to intervene; it must respect existing idempotency and audit rules.

## Scope

Implement these first:

- Postgres and Prisma fields for scheduler lease, attempts, errors, and backoff.
- Settings repository methods to atomically claim due workspaces and mark success/failure.
- An internal scheduled repair method that runs for a workspace without requiring browser header auth.
- A standalone worker entry point in `apps/api/src/research-continuity`.
- Package script for the worker process.
- Operations health fields for worker automation state.
- Small UI additions to display automation state and recent failure context.
- Tests for claim semantics, idempotency, failure/backoff, and health fields.
- Docs updates for V1.8 and runtime configuration.

## Non-Goals

Do not implement:

- Timeline, graph/node model, provenance explorer, or multi-symbol continuity views.
- AI-service, Python graph, or SQLite changes.
- A generic scheduler framework.
- A generic audit framework.
- Workspace member-management UI.
- Workspace debug policy/settings.
- Audit retention policy.
- Research run creation from the continuity scheduler.
- BullMQ queueing for continuity repair unless required by the existing code path. Polling plus DB lease is enough for V1.8.
- External cron-only HTTP automation as the primary design.
- Manual force-run, force-unlock, or lease override controls.
- Continuity diff/report UX improvements. Those belong in a later report-view
  version, not this worker hardening release.
- Calibration, PnL, thesis correctness, or performance scoring changes.

## Current Code Context

Inspect these files first:

```text
docs/features/research-continuity/README.md
docs/features/research-continuity/v1.7/implementation-plan.md
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/research-continuity-settings.repository.ts
apps/api/src/research-continuity/research-continuity-settings.types.ts
apps/api/src/research-continuity/research-continuity-audit.repository.ts
apps/api/src/research-continuity/research-continuity-audit.types.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/operations/operations.service.ts
apps/api/src/database/postgres-schema.sql
packages/database/prisma/schema.prisma
apps/api/src/jobs/research-worker.ts
apps/api/package.json
docker-compose.yml
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/pages/OperationsPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/types/index.ts
apps/api/test/api-contract.test.ts
```

Important existing behavior:

- V1.7 settings are workspace-scoped and default disabled.
- `runDueScheduledRepair` already uses deterministic idempotency key
  `research-continuity-scheduler:<workspace_id>:<due_basis>`.
- V1.6 repair run history is durable in `research_continuity_repair_runs`.
- Manual scheduler APIs require admin access.
- Operations health already exposes scheduled repair mode, due state, next due time, and last scheduled run.
- A separate research BullMQ worker already exists as a process pattern in `apps/api/src/jobs/research-worker.ts`.

## Data Model

Extend `research_continuity_workspace_settings`:

```sql
ALTER TABLE research_continuity_workspace_settings
ADD COLUMN IF NOT EXISTS scheduler_lease_owner TEXT,
ADD COLUMN IF NOT EXISTS scheduler_lease_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_attempt_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_success_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_scheduler_error TEXT,
ADD COLUMN IF NOT EXISTS consecutive_scheduler_failures INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_scheduler_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_worker_due
ON research_continuity_workspace_settings(
  scheduled_repair_mode,
  next_scheduler_retry_at,
  next_scheduled_repair_due_at,
  scheduler_lease_expires_at
);
```

Do not add a separate scheduler job table in V1.8. The durable repair run table remains the execution history. The workspace settings row owns scheduling metadata.

## Settings Repository Contract

Add types:

```ts
export interface ResearchContinuitySchedulerClaimOptions {
  worker_id: string;
  now: string;
  limit: number;
  lease_seconds: number;
}

export interface ResearchContinuitySchedulerSuccessInput {
  workspace_id: string;
  worker_id: string;
  completed_at: string;
  last_scheduled_repair_run_id: string;
  next_scheduled_repair_due_at: string;
}

export interface ResearchContinuitySchedulerFailureInput {
  workspace_id: string;
  worker_id: string;
  failed_at: string;
  error_message: string;
  next_scheduler_retry_at: string;
  consecutive_scheduler_failures: number;
}

export interface ResearchContinuitySchedulerLeaseClearInput {
  workspace_id: string;
  worker_id: string;
  cleared_at: string;
}
```

Add methods:

```ts
claimDueWorkspaceSettings(
  options: ResearchContinuitySchedulerClaimOptions,
): Promise<JsonRecord[]>;

markSchedulerSuccess(
  input: ResearchContinuitySchedulerSuccessInput,
): Promise<JsonRecord>;

markSchedulerFailure(
  input: ResearchContinuitySchedulerFailureInput,
): Promise<JsonRecord>;

clearSchedulerLease(
  input: ResearchContinuitySchedulerLeaseClearInput,
): Promise<JsonRecord>;
```

Claim query must be atomic. It should only return rows this worker claimed:

```sql
WITH due AS (
  SELECT workspace_id
  FROM research_continuity_workspace_settings
  WHERE scheduled_repair_mode IN ('dry_run', 'enabled')
    AND COALESCE(next_scheduled_repair_due_at, $2::timestamptz) <= $2::timestamptz
    AND COALESCE(next_scheduler_retry_at, $2::timestamptz) <= $2::timestamptz
    AND (
      scheduler_lease_expires_at IS NULL
      OR scheduler_lease_expires_at <= $2::timestamptz
    )
  ORDER BY next_scheduled_repair_due_at ASC NULLS FIRST, updated_at ASC
  LIMIT $3
  FOR UPDATE SKIP LOCKED
)
UPDATE research_continuity_workspace_settings settings
SET scheduler_lease_owner = $1,
    scheduler_lease_expires_at = $2::timestamptz + make_interval(secs => $4),
    last_scheduler_attempt_at = $2::timestamptz,
    updated_at = $2::timestamptz
FROM due
WHERE settings.workspace_id = due.workspace_id
RETURNING jsonb_build_object(...)
```

The repository should keep using parameterized SQL and `jsonb_build_object`, matching the current Postgres repository style.

`markSchedulerSuccess`, `markSchedulerFailure`, and `clearSchedulerLease` must
all be lease-guarded:

```sql
WHERE workspace_id = $1
  AND scheduler_lease_owner = $2
```

If the row is missing or the lease owner does not match, return or throw a
controlled conflict. Do not let a stale worker clear another worker's lease or
advance another worker's due row.

## Service Boundary

Keep public controller behavior unchanged.

Add an internal method on `ResearchContinuityService`:

```ts
async runDueScheduledRepairForWorkspace(
  workspaceId: string,
  actorUserId: string,
  options?: { now?: Date; source?: 'manual' | 'worker' },
): Promise<ResearchContinuitySchedulerRunDueResponse>
```

Then make the current public method call it after admin auth:

```ts
async runDueScheduledRepair(userId?: string, workspaceHeader?: string) {
  const workspaceId = await this.resolveWorkspaceAccess(
    userId,
    workspaceHeader,
    'admin',
  );
  const actor = this.auth.resolveUser(userId);
  return this.runDueScheduledRepairForWorkspace(workspaceId, actor, {
    source: 'manual',
  });
}
```

The worker should call:

```ts
await continuity.runDueScheduledRepairForWorkspace(
  workspaceId,
  systemActor,
  { now, source: 'worker' },
);
```

Use a system actor from env:

```text
RESEARCH_CONTINUITY_SCHEDULER_ACTOR=system:research-continuity-scheduler
```

Default to the same string when env is missing.

Manual behavior must stay V1.7-compatible except for the active lease guard:

```text
admin auth still required
disabled/not_due/no_case_types behavior is unchanged
idempotency key shape is unchanged
manual success still persists next due through the existing scheduler settings path
manual active worker lease returns skipped_reason = worker_lease_active
```

Worker behavior differs at one point only:

```text
source = worker creates or reuses the repair run with the same idempotency key
source = worker computes the next due time but does not persist it
worker code calls markSchedulerSuccess(worker_id, next_due) after completed repair history is confirmed
```

This prevents double-advance bugs while keeping the manual endpoint compatible
with V1.7.

## Worker Runtime

Create:

```text
apps/api/src/research-continuity/research-continuity-scheduler.worker.ts
```

Runtime config:

```text
RESEARCH_CONTINUITY_SCHEDULER_ENABLED=false
RESEARCH_CONTINUITY_SCHEDULER_INTERVAL_MS=60000
RESEARCH_CONTINUITY_SCHEDULER_BATCH_SIZE=1
RESEARCH_CONTINUITY_SCHEDULER_LEASE_SECONDS=300
RESEARCH_CONTINUITY_SCHEDULER_ACTOR=system:research-continuity-scheduler
RESEARCH_CONTINUITY_SCHEDULER_HEALTH_FILE=/tmp/lunacrypto-continuity-scheduler-health
```

Behavior:

```text
load env
exit early if scheduler enabled flag is not true
construct Postgres journal, audit, settings, auth, workspace service, continuity service
create stable worker id
write health file at startup and after each tick
poll every configured interval
claim due workspace settings
for each claimed workspace, sequentially:
  call runDueScheduledRepairForWorkspace
  if success and repair run is completed or completed_with_failures:
    mark scheduler success and clear failure/backoff using the matching worker lease
  if skipped not_due/scheduler_disabled/no_case_types:
    clear the matching worker lease without changing due unless disabled semantics already apply
  if skipped worker_lease_active:
    treat as a controlled no-op and do not clear another worker's lease
  if failure:
    compute backoff and mark scheduler failure
handle SIGINT/SIGTERM and close pools
```

Do not import the Nest application module. Follow the lightweight construction pattern from `apps/api/src/jobs/research-worker.ts`.

## Failure And Backoff

Backoff function:

```ts
function schedulerBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return 5 * 60 * 1000;
  if (consecutiveFailures === 2) return 15 * 60 * 1000;
  if (consecutiveFailures === 3) return 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}
```

Failure handling rule:

```text
next_scheduled_repair_due_at remains unchanged
next_scheduler_retry_at moves forward by backoff
consecutive_scheduler_failures increments by 1
last_scheduler_error stores a sanitized one-line message
scheduler lease is cleared or allowed to expire
```

Success handling rule:

```text
last_scheduler_success_at = completed_at
last_scheduler_error = null
consecutive_scheduler_failures = 0
next_scheduler_retry_at = null
scheduler lease is cleared
next_scheduled_repair_due_at advances through lease-guarded markSchedulerSuccess for worker runs
```

Crash replay rule:

```text
worker creates or finds an idempotent repair run
process crashes before scheduler success metadata is written
lease expires
next worker claims the same due row
same idempotency key returns the existing repair run
completed or completed_with_failures repair run is treated as scheduler success
started or failed repair run is treated as scheduler failure and must not advance due time
```

## Operations Health

Extend continuity health with:

```ts
scheduled_repair_worker_enabled: boolean;
scheduled_repair_lease_owner: string | null;
scheduled_repair_lease_expires_at: string | null;
scheduled_repair_last_attempt_at: string | null;
scheduled_repair_last_success_at: string | null;
scheduled_repair_last_error: string | null;
scheduled_repair_consecutive_failures: number;
scheduled_repair_next_retry_at: string | null;
```

For V1.8, Operations health remains current-workspace scoped. Do not add
cross-workspace due counts in the API health endpoint; the worker claim query is
the authority for cross-workspace due selection. If repository support is
unavailable, return safe defaults with `scheduled_repair_worker_enabled` based
on env.

## UI Scope

Keep the existing Research Continuity maintenance panel.

Add compact fields in the scheduler controls panel:

```text
Worker enabled
Last attempt
Last success
Next retry
Failures
Last error
```

Add matching compact fields in Operations Continuity Health.

Do not create a new page.

## Task Plan

### Task 1: Add Schema And Contract Fields

**Files:**
- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [x] **Step 1: Add failing schema assertions**

Add an API contract test asserting the Postgres schema contains:

```text
scheduler_lease_owner
scheduler_lease_expires_at
last_scheduler_attempt_at
last_scheduler_success_at
last_scheduler_error
consecutive_scheduler_failures
next_scheduler_retry_at
idx_research_continuity_workspace_settings_worker_due
```

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected: FAIL because the columns are missing.

- [x] **Step 2: Add Postgres columns and index**

Update `apps/api/src/database/postgres-schema.sql` with the SQL from the Data Model section.

- [x] **Step 3: Add Prisma metadata**

Extend `ResearchContinuityWorkspaceSettings` in `packages/database/prisma/schema.prisma` with mapped fields:

```prisma
schedulerLeaseOwner           String?   @map("scheduler_lease_owner")
schedulerLeaseExpiresAt       DateTime? @map("scheduler_lease_expires_at") @db.Timestamptz(6)
lastSchedulerAttemptAt        DateTime? @map("last_scheduler_attempt_at") @db.Timestamptz(6)
lastSchedulerSuccessAt        DateTime? @map("last_scheduler_success_at") @db.Timestamptz(6)
lastSchedulerError            String?   @map("last_scheduler_error")
consecutiveSchedulerFailures  Int       @default(0) @map("consecutive_scheduler_failures")
nextSchedulerRetryAt          DateTime? @map("next_scheduler_retry_at") @db.Timestamptz(6)
```

Add the matching index metadata.

- [x] **Step 4: Extend DTO and frontend contract types**

Add the fields from Operations Health and workspace settings responses where needed. Keep existing fields backward-compatible.

Also extend `ResearchContinuitySchedulerRunDueResponse['skipped_reason']` with:

```ts
| 'worker_lease_active'
```

Expose lease metadata in workspace settings responses only where the UI and
service need it:

```ts
scheduler_lease_owner: string | null;
scheduler_lease_expires_at: string | null;
last_scheduler_attempt_at: string | null;
last_scheduler_success_at: string | null;
last_scheduler_error: string | null;
consecutive_scheduler_failures: number;
next_scheduler_retry_at: string | null;
```

- [x] **Step 5: Verify**

Run:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: PASS.

### Task 2: Add Settings Repository Claim And Mark Methods

**Files:**
- Modify: `apps/api/src/research-continuity/research-continuity-settings.types.ts`
- Modify: `apps/api/src/research-continuity/research-continuity-settings.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [x] **Step 1: Add failing repository source test**

Assert the repository source contains:

```text
claimDueWorkspaceSettings
FOR UPDATE SKIP LOCKED
scheduler_lease_owner
markSchedulerSuccess
markSchedulerFailure
clearSchedulerLease
next_scheduler_retry_at
```

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected: FAIL before implementation.

- [x] **Step 2: Add types**

Add the repository input interfaces from the Settings Repository Contract
section, including `ResearchContinuitySchedulerLeaseClearInput`.

- [x] **Step 3: Implement claim**

Add `claimDueWorkspaceSettings` using a single atomic `WITH due AS (...) UPDATE ... RETURNING` query. Use `settingsPayloadSql()` so returned rows normalize through the existing `parsePayload`.

The claim must treat active rows with `next_scheduled_repair_due_at = null` as
due now:

```sql
AND COALESCE(next_scheduled_repair_due_at, $2::timestamptz) <= $2::timestamptz
```

Do not claim disabled rows.

- [x] **Step 4: Implement success and failure markers**

`markSchedulerSuccess` clears lease, clears error/backoff, resets failure count,
stores last scheduled run metadata, and advances
`next_scheduled_repair_due_at`. Its update must include both `workspace_id` and
`worker_id` in the `WHERE` clause.

`markSchedulerFailure` clears lease, stores attempt failure details, increments
or sets failure count, and stores `next_scheduler_retry_at`. Its update must
include both `workspace_id` and `worker_id` in the `WHERE` clause.

`clearSchedulerLease` clears only `scheduler_lease_owner` and
`scheduler_lease_expires_at` for controlled skips. It must not change
`next_scheduled_repair_due_at`, failure counters, or success timestamps, and it
must include both `workspace_id` and `worker_id` in the `WHERE` clause.

- [x] **Step 5: Verify**

Run:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: PASS.

### Task 3: Split Manual And Internal Scheduled Repair Execution

**Files:**
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [x] **Step 1: Add failing service behavior tests**

Add tests for:

```text
manual run-due still requires admin access
manual run-due returns worker_lease_active while an unexpired worker lease exists
internal workspace run does not call workspace header auth
internal workspace run uses system actor in repair audit requested_by_user_id
completed manual internal run advances due time
completed worker internal run returns a proposed next due but does not persist due advancement
completed_with_failures worker replay is treated as scheduler success by the worker layer
failed internal run does not advance due time
```

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected: FAIL because the internal method is missing.

- [x] **Step 2: Add internal method**

Add:

```ts
async runDueScheduledRepairForWorkspace(
  workspaceId: string,
  actorUserId: string,
  options: { now?: Date; source?: 'manual' | 'worker' } = {},
): Promise<ResearchContinuitySchedulerRunDueResponse>
```

Move the current due logic into this method.

Behavior split:

```text
source manual:
  reject active unexpired worker lease with skipped_reason worker_lease_active
  preserve V1.7 due execution and persisted due advancement

source worker:
  do not reject the worker-owned active lease
  create or reuse the repair run with the existing idempotency key shape
  compute next due from now + scheduled_repair_interval_hours
  return next_scheduled_repair_due_at as the proposed next due
  do not persist next due or clear the lease
```

- [x] **Step 3: Keep public endpoint behavior**

Make `runDueScheduledRepair(userId, workspaceHeader)` resolve admin access and call the internal method with `source: 'manual'`.

- [x] **Step 4: Preserve idempotency**

Keep the existing idempotency key shape:

```text
research-continuity-scheduler:<workspace_id>:<due_basis>
```

Do not include worker id in the idempotency key.

If `source: 'worker'` replays an existing idempotent repair run with status
`completed` or `completed_with_failures`, return it as a successful repair
attempt so the worker can call `markSchedulerSuccess`.

- [x] **Step 5: Verify**

Run:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: PASS.

### Task 4: Add Scheduler Worker Process

**Files:**
- Create: `apps/api/src/research-continuity/research-continuity-scheduler.worker.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Optionally modify: `docker-compose.yml`
- Test: `apps/api/test/api-contract.test.ts`

- [x] **Step 1: Add source-shape test**

Assert worker source contains:

```text
RESEARCH_CONTINUITY_SCHEDULER_ENABLED
RESEARCH_CONTINUITY_SCHEDULER_INTERVAL_MS
claimDueWorkspaceSettings
markSchedulerSuccess
markSchedulerFailure
clearSchedulerLease
runDueScheduledRepairForWorkspace
SIGTERM
```

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected: FAIL because the worker file is missing.

- [x] **Step 2: Create worker entry point**

Follow the lightweight construction style from `apps/api/src/jobs/research-worker.ts`. Instantiate:

```text
PostgresJournalRepository
PostgresResearchContinuityAuditRepository
PostgresResearchContinuitySettingsRepository
AuthService
WorkspacesService
ResearchContinuityService
```

- [x] **Step 3: Implement tick loop**

One tick should:

```text
claim due workspace rows
run each claimed workspace sequentially
mark success, failure, or controlled lease clear
write health file
avoid overlapping ticks
```

Use sequential execution in V1.8. Do not add concurrency until a real workload requires it.

Worker success rule:

```text
repair run status completed or completed_with_failures
  -> markSchedulerSuccess with the same worker_id that claimed the row
repair run status started or failed
  -> markSchedulerFailure and keep next_scheduled_repair_due_at unchanged
```

- [x] **Step 4: Add package scripts**

In `apps/api/package.json`:

```json
"start:continuity-scheduler": "node ../../dist/apps/api/src/research-continuity/research-continuity-scheduler.worker.js"
```

In root `package.json`:

```json
"worker:continuity-scheduler": "pnpm --filter @lunaperception/api start:continuity-scheduler"
```

- [x] **Step 5: Optionally add Docker Compose service**

Add a `continuity-scheduler` service only as a local/self-host convenience. Keep the plan explicit that production can run this as any separate process.

- [x] **Step 6: Verify**

Run:

```bash
pnpm --filter @lunaperception/api build
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: PASS.

### Task 5: Extend Operations Health And UI

**Files:**
- Modify: `apps/api/src/operations/operations.service.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/OperationsPage.tsx`
- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
- Test: `apps/api/test/api-contract.test.ts`

- [x] **Step 1: Add failing operations health test**

Assert `/operations/health` continuity response includes worker fields and safe defaults when repository support is unavailable.

- [x] **Step 2: Add service mapping**

Read the current workspace settings row and map:

```text
scheduler_lease_owner
scheduler_lease_expires_at
last_scheduler_attempt_at
last_scheduler_success_at
last_scheduler_error
consecutive_scheduler_failures
next_scheduler_retry_at
```

Map `scheduled_repair_worker_enabled` from
`RESEARCH_CONTINUITY_SCHEDULER_ENABLED`. Safe defaults when settings are
unavailable:

```text
scheduled_repair_lease_owner = null
scheduled_repair_lease_expires_at = null
scheduled_repair_last_attempt_at = null
scheduled_repair_last_success_at = null
scheduled_repair_last_error = null
scheduled_repair_consecutive_failures = 0
scheduled_repair_next_retry_at = null
```

Do not add cross-workspace aggregate counts in V1.8. Current-workspace worker
health is required; cross-workspace scheduler state belongs in a later
operations dashboard if needed.

- [x] **Step 3: Update web panels**

Add compact fields to the Research Continuity scheduler controls and Operations Continuity Health panel.

- [x] **Step 4: Verify**

Run:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: PASS.

### Task 6: Final Verification And Docs

**Files:**
- Modify: `docs/features/research-continuity/README.md`
- Modify: `docs/features/README.md`
- Modify: `apps/web/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Add runtime config docs**

Document:

```text
RESEARCH_CONTINUITY_SCHEDULER_ENABLED
RESEARCH_CONTINUITY_SCHEDULER_INTERVAL_MS
RESEARCH_CONTINUITY_SCHEDULER_BATCH_SIZE
RESEARCH_CONTINUITY_SCHEDULER_LEASE_SECONDS
RESEARCH_CONTINUITY_SCHEDULER_ACTOR
RESEARCH_CONTINUITY_SCHEDULER_HEALTH_FILE
```

- [x] **Step 2: Run full validation**

Run:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: PASS. The existing web large chunk warning is acceptable if unchanged.

- [ ] **Step 3: Manual smoke**

Use a local Postgres database with at least one due dry-run workspace setting:

```text
RESEARCH_CONTINUITY_SCHEDULER_ENABLED=true
RESEARCH_CONTINUITY_SCHEDULER_INTERVAL_MS=5000
```

Start:

```bash
pnpm --filter @lunaperception/api start:continuity-scheduler
```

Verify:

```text
worker health file updates
due dry-run creates durable repair history
next due advances after completed repair
failure path records last_scheduler_error and next_scheduler_retry_at
manual run-due still works
/operations shows worker state
/research-continuity shows worker state
```

- [x] **Step 4: Update docs to implemented**

After implementation and verification, change V1.8 status from `goal-ready` to `implemented`, add completion notes with exact commands, and update feature registry.

## Completion Notes

Implemented on 2026-05-30.

Validation passed:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

`pnpm --filter @lunaperception/api test` passed 142 tests. The web build passed
with the existing large chunk warning.

Worker disabled-start smoke passed:

```bash
RESEARCH_CONTINUITY_SCHEDULER_ENABLED=false
RESEARCH_CONTINUITY_SCHEDULER_HEALTH_FILE=<temp health file>
pnpm --filter @lunaperception/api start:continuity-scheduler
```

The worker exited with `Research continuity scheduler worker is disabled.` and
wrote a health file with `status: "disabled"`.

The local Postgres due dry-run smoke could not run in this session because
`docker compose up -d postgres` could not connect to the Docker Desktop Linux
engine (`dockerDesktopLinuxEngine` pipe missing). Run the manual smoke checklist
again when a local Postgres instance is available.

## Definition Of Done

- V1.8 plan is implemented without adding new research-product features.
- Scheduler worker is a separate process and is disabled by default.
- API web server does not start continuity scheduler timers.
- Due workspace settings are claimed atomically with Postgres lease semantics.
- Multiple worker processes do not execute the same due workspace concurrently.
- Existing scheduler idempotency key prevents duplicate repair history after crash/retry.
- Successful scheduled repair advances next due time.
- Failed scheduled repair does not advance next due time.
- Failed scheduled repair records sanitized error and exponential backoff.
- Worker can recover after process restart.
- Manual run-due endpoint keeps V1.7 behavior.
- Operations and Research Continuity UI show current worker automation state.
- API tests, API lint, web lint, web typecheck, and web build pass.

## Version Placement

```text
V1.6  Auditability, repair history, and operations health.
V1.7  Workspace scheduled repair controls with manual run-due execution.
V1.8  Automated scheduled repair worker with DB lease, backoff, and health.
V1.9  Workspace debug policy/settings or audit retention, if still needed.
V2.x  Timeline, graph/node model, provenance explorer, and multi-symbol views.
```

Do not start V2 continuity surfaces until V1.8 proves the automated repair path can run without duplicate mutation, silent failure, or operator confusion.
