# Research Continuity V1.7 Scheduled Repair Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-scoped scheduled repair controls for Research Continuity without introducing automatic background timers yet.

**Architecture:** V1.7 stores one repair scheduler settings row per workspace, exposes admin-only scheduler control APIs, and reuses the V1.6 durable repair history path for every due run. Scheduler execution is manual through `POST /research-continuity/scheduler/run-due`; no in-process timer, cron loop, or worker automation is added in this version.

**Tech Stack:** NestJS API, TypeScript DTOs/contracts, Postgres SQL schema, Prisma schema metadata, colocated Research Continuity settings repository, React Query, existing Research Continuity and Operations pages.

---

Last updated: 2026-05-30
Status: goal-ready

## One Outcome

V1.7 should let an operator decide whether the current workspace is allowed to
run scheduled continuity repair, inspect when it is due, and execute the due
repair path with full V1.6 audit history.

The target workflow is:

```text
open Research Continuity maintenance
  -> inspect scheduler mode and next due time
  -> update workspace repair settings
  -> run due scheduled repair manually
  -> inspect durable repair run history
```

This is intentionally not a new user-facing research feature. It is the final
control layer before any true background repair automation can be considered.

## V1.7 Must Ship

V1.7 is not just a decision record. It should ship a complete operator workflow
around the repair tooling that already exists:

1. Workspace repair scheduler settings.
2. Scheduler status and manual due-run execution.
3. Safe default-off behavior with deterministic idempotency.
4. Operations health visibility for scheduler state.
5. Research Continuity maintenance UI for settings and due-run control.
6. Repair run detail inspection from the UI, not only the summary list.
7. Focused API and web verification so the workflow is safe to automate later.

If a task does not support one of those seven outcomes, keep it out of V1.7.

## Product Decisions

- V1.7 remains part of Research Continuity.
- Scheduled repair is workspace-scoped and default-off.
- Settings live in Postgres, not environment variables.
- Allowed modes are `disabled`, `dry_run`, and `enabled`.
- `missing_continuity` and `legacy_evidence` are safe auto-execute cases.
- `skipped_or_degraded` is allowed only when the scheduler mode is `dry_run`.
- V1.7 does not add an automatic timer. The only scheduler execution path is an
  admin-triggered `run-due` endpoint.
- V1.7 does not add workspace debug settings. Keep the existing global debug
  policy and V1.6 debug audit behavior unchanged.

## Scope

Implement these first:

- Postgres and Prisma schema for one workspace scheduler settings row.
- A small Research Continuity settings repository.
- Admin read/update APIs for workspace repair scheduler settings.
- Admin scheduler status and manual `run-due` APIs.
- Scheduler due logic that calls the existing repair execution path with a
  deterministic idempotency key.
- UI controls in the existing Research Continuity maintenance area.
- Repair run detail drilldown in the maintenance area using the existing
  `GET /research-continuity/repair/runs/:id` API.
- Compact scheduler visibility in Operations health.
- Focused API tests and web type/build verification.

## Non-Goals

Do not implement:

- In-process `setInterval` repair execution.
- Cron, BullMQ, Redis, or monitoring worker integration for continuity repair.
- Cross-workspace scheduler runs.
- Workspace member-management UI.
- Workspace debug policy/settings.
- Audit retention policy.
- A full debug audit browser UI.
- Generic settings framework.
- Generic scheduler framework.
- AI-service, SQLite schema, graph, semantic retrieval, timeline, or multi-symbol
  continuity changes.
- Calibration, PnL, thesis correctness, or performance scoring changes.

## Current Code Context

Inspect these files first:

```text
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/research-continuity/research-continuity-audit.repository.ts
apps/api/src/research-continuity/research-continuity-audit.types.ts
apps/api/src/operations/operations.service.ts
apps/api/src/database/postgres-schema.sql
packages/database/prisma/schema.prisma
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/pages/OperationsPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/operations.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/api/test/api-contract.test.ts
```

Important existing behavior:

- `POST /research-continuity/repair/run` requires admin access.
- Repair run history is durable in `research_continuity_repair_runs`.
- Repair run idempotency already exists through `idempotency_key`.
- Operations health already includes a compact `continuity` section.
- The Research Continuity page already has a maintenance repair panel and recent
  repair runs list.

## Data Model

Add this Postgres table:

```sql
CREATE TABLE IF NOT EXISTS research_continuity_workspace_settings (
    workspace_id TEXT PRIMARY KEY,
    scheduled_repair_mode TEXT NOT NULL DEFAULT 'disabled' CHECK (
        scheduled_repair_mode IN ('disabled', 'dry_run', 'enabled')
    ),
    scheduled_repair_case_types_json JSONB NOT NULL DEFAULT '["missing_continuity","legacy_evidence"]'::jsonb,
    scheduled_repair_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (
        scheduled_repair_interval_hours BETWEEN 1 AND 168
    ),
    scheduled_repair_lookback_days INTEGER NOT NULL DEFAULT 30 CHECK (
        scheduled_repair_lookback_days BETWEEN 1 AND 365
    ),
    scheduled_repair_limit INTEGER NOT NULL DEFAULT 25 CHECK (
        scheduled_repair_limit BETWEEN 1 AND 100
    ),
    next_scheduled_repair_due_at TIMESTAMPTZ,
    last_scheduled_repair_at TIMESTAMPTZ,
    last_scheduled_repair_run_id TEXT,
    updated_by_user_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_due
ON research_continuity_workspace_settings(scheduled_repair_mode, next_scheduled_repair_due_at);

CREATE INDEX IF NOT EXISTS idx_research_continuity_workspace_settings_updated
ON research_continuity_workspace_settings(updated_at DESC);
```

Mirror the model in `packages/database/prisma/schema.prisma`. Do not add a
SQLite migration in V1.7.

Default settings when no row exists:

```json
{
  "workspace_id": "<current workspace>",
  "scheduled_repair_mode": "disabled",
  "scheduled_repair_case_types": ["missing_continuity", "legacy_evidence"],
  "scheduled_repair_interval_hours": 24,
  "scheduled_repair_lookback_days": 30,
  "scheduled_repair_limit": 25,
  "next_scheduled_repair_due_at": null,
  "last_scheduled_repair_at": null,
  "last_scheduled_repair_run_id": null,
  "updated_by_user_id": null,
  "updated_at": null
}
```

## Repository Boundary

Add:

```text
apps/api/src/research-continuity/research-continuity-settings.types.ts
apps/api/src/research-continuity/research-continuity-settings.repository.ts
```

Use a dedicated provider token:

```ts
export const RESEARCH_CONTINUITY_SETTINGS_REPOSITORY =
  Symbol('RESEARCH_CONTINUITY_SETTINGS_REPOSITORY');
```

Required methods:

```ts
getWorkspaceSettings(workspaceId): Promise<JsonRecord | null>;
upsertWorkspaceSettings(input): Promise<JsonRecord>;
markScheduledRepairRun(input): Promise<JsonRecord>;
```

The Postgres implementation may open its own `pg.Pool` from `DATABASE_URL`,
matching the V1.6 audit repository. Do not refactor the wider database layer in
V1.7.

## API Contract

Add admin-only endpoints:

```text
GET /research-continuity/settings
PATCH /research-continuity/settings
GET /research-continuity/scheduler
POST /research-continuity/scheduler/run-due
```

`GET /research-continuity/settings` returns current workspace settings. If no DB
row exists, return defaults without creating a row.

`PATCH /research-continuity/settings` accepts:

```ts
interface UpdateResearchContinuitySettingsRequest {
  scheduled_repair_mode?: 'disabled' | 'dry_run' | 'enabled';
  scheduled_repair_case_types?: Array<
    'missing_continuity' | 'skipped_or_degraded' | 'legacy_evidence'
  >;
  scheduled_repair_interval_hours?: number;
  scheduled_repair_lookback_days?: number;
  scheduled_repair_limit?: number;
}
```

Validation rules:

- `scheduled_repair_case_types` must be non-empty after trimming duplicates.
- `enabled` mode cannot include `skipped_or_degraded`.
- `dry_run` mode can include all three repair case types.
- `disabled` mode can store case types, but `run-due` must not execute them.
- `scheduled_repair_interval_hours` must be `1..168`.
- `scheduled_repair_lookback_days` must be `1..365`.
- `scheduled_repair_limit` must be `1..100`.

When settings are updated:

- `updated_by_user_id` is the authenticated admin user.
- `updated_at` is current time.
- If `scheduled_repair_mode` changes from `disabled` to `dry_run` or `enabled`
  and `next_scheduled_repair_due_at` is null, set it to current time so the
  operator can run due repair immediately.
- If mode changes to `disabled`, preserve the last due/run fields but report the
  scheduler as not due.

`GET /research-continuity/scheduler` returns:

```ts
interface ResearchContinuitySchedulerStatusResponse {
  workspace_id: string;
  settings: ResearchContinuityWorkspaceSettingsResponse;
  due: boolean;
  disabled: boolean;
  dry_run: boolean;
  next_scheduled_repair_due_at: string | null;
  last_scheduled_repair_at: string | null;
  last_scheduled_repair_run_id: string | null;
  last_scheduled_repair_status: string | null;
}
```

`POST /research-continuity/scheduler/run-due` returns:

```ts
interface ResearchContinuitySchedulerRunDueResponse {
  workspace_id: string;
  due: boolean;
  skipped_reason:
    | null
    | 'scheduler_disabled'
    | 'not_due'
    | 'no_case_types'
    | 'settings_unavailable';
  dry_run: boolean;
  audit_run_id: string | null;
  repair_run: ResearchContinuityRepairRunResponse | null;
  next_scheduled_repair_due_at: string | null;
}
```

`run-due` behavior:

- Requires admin access to the current `x-workspace-id`.
- If no settings row exists, use defaults and return `scheduler_disabled`.
- If mode is `disabled`, do not create a repair run.
- If now is before `next_scheduled_repair_due_at`, do not create a repair run.
- If mode is `dry_run`, call repair with `dry_run: true`.
- If mode is `enabled`, call repair with `dry_run: false`.
- Generate a deterministic idempotency key:
  `research-continuity-scheduler:<workspace_id>:<next_due_or_now_iso>`.
- Use filters:
  - `from = now - scheduled_repair_lookback_days`
  - `to = now`
  - `limit = scheduled_repair_limit`
  - `case_types = scheduled_repair_case_types`
- After a due run completes or returns an existing idempotent run, update
  `last_scheduled_repair_at`, `last_scheduled_repair_run_id`, and
  `next_scheduled_repair_due_at = now + interval_hours`.
- If the repair call throws, do not advance `next_scheduled_repair_due_at`.

## Operations Health

Extend the existing `continuity` health response with scheduler fields:

```ts
scheduled_repair_mode: 'disabled' | 'dry_run' | 'enabled';
scheduled_repair_due: boolean;
next_scheduled_repair_due_at: string | null;
last_scheduled_repair_run_id: string | null;
```

If the settings repository is unavailable, keep the existing health response
available and return:

```json
{
  "scheduled_repair_mode": "disabled",
  "scheduled_repair_due": false,
  "next_scheduled_repair_due_at": null,
  "last_scheduled_repair_run_id": null
}
```

Do not fail `/operations/health` only because continuity settings are
unavailable.

## UI Scope

Update `/research-continuity` maintenance:

- Show current scheduler mode for the current workspace.
- Add a compact settings control:
  - segmented control for `disabled`, `dry run`, `enabled`;
  - checkboxes for repair case types;
  - numeric inputs for interval hours, lookback days, and limit;
  - save button.
- When `enabled` mode is selected, disable or reject `skipped_or_degraded` and
  explain through field-level copy outside the button.
- Show scheduler status: due/not due, next due time, last scheduled repair run.
- Add a `Run due repair` button that calls `POST /research-continuity/scheduler/run-due`.
- Keep the existing manual repair preview/run panel.
- Extend Recent Repair Runs so selecting a run fetches and renders detail:
  filters, created entry IDs, error message, and per-candidate results.

Update `/operations`:

- Add scheduler mode, due state, and next due time to the existing Continuity
  Health panel.

Do not create a new page in V1.7.

## Task Plan

### Task 1: Add Schema And Types

**Files:**

- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing schema contract assertions**

In `apps/api/test/api-contract.test.ts`, add a test that reads
`postgres-schema.sql`, normalizes CRLF to LF, and asserts these fragments:

```ts
test('postgres research continuity workspace settings schema declares scheduler controls', () => {
  const schema = readFileSync(
    join(process.cwd(), 'src', 'database', 'postgres-schema.sql'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  for (const fragment of [
    'CREATE TABLE IF NOT EXISTS research_continuity_workspace_settings',
    "scheduled_repair_mode TEXT NOT NULL DEFAULT 'disabled'",
    'scheduled_repair_case_types_json JSONB NOT NULL',
    'idx_research_continuity_workspace_settings_due',
  ]) {
    assert.ok(schema.includes(fragment), `missing schema fragment: ${fragment}`);
  }
});
```

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because the table does not exist.

- [ ] **Step 2: Add Postgres schema**

Add the SQL table and indexes from the Data Model section to
`apps/api/src/database/postgres-schema.sql`.

- [ ] **Step 3: Add Prisma metadata**

Add a Prisma model mapped to `research_continuity_workspace_settings` with
camelCase fields matching existing Prisma style.

- [ ] **Step 4: Add DTO types**

Add request/response interfaces and mode types to
`apps/api/src/research-continuity/dto/research-continuity.dto.ts`.

- [ ] **Step 5: Verify schema test passes**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: schema contract test passes.

### Task 2: Add Settings Repository

**Files:**

- Create: `apps/api/src/research-continuity/research-continuity-settings.types.ts`
- Create: `apps/api/src/research-continuity/research-continuity-settings.repository.ts`
- Modify: `apps/api/src/research-continuity/research-continuity.module.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing repository source test**

Add a source-level contract test that verifies the repository uses an upsert and
updates due metadata:

```ts
test('research continuity settings repository upserts workspace settings and due metadata', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src',
      'research-continuity',
      'research-continuity-settings.repository.ts',
    ),
    'utf8',
  );
  for (const fragment of [
    'research_continuity_workspace_settings',
    'ON CONFLICT (workspace_id)',
    'next_scheduled_repair_due_at',
    'last_scheduled_repair_run_id',
  ]) {
    assert.ok(source.includes(fragment), `missing settings repository fragment: ${fragment}`);
  }
});
```

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because the repository file does not exist.

- [ ] **Step 2: Add settings repository types**

Define:

```ts
export type ResearchContinuityScheduledRepairMode =
  | 'disabled'
  | 'dry_run'
  | 'enabled';

export interface ResearchContinuityWorkspaceSettingsUpsertInput {
  workspace_id: string;
  scheduled_repair_mode: ResearchContinuityScheduledRepairMode;
  scheduled_repair_case_types: string[];
  scheduled_repair_interval_hours: number;
  scheduled_repair_lookback_days: number;
  scheduled_repair_limit: number;
  next_scheduled_repair_due_at?: string | null;
  updated_by_user_id: string;
  updated_at?: string;
}

export interface ResearchContinuityMarkScheduledRepairRunInput {
  workspace_id: string;
  last_scheduled_repair_at?: string;
  last_scheduled_repair_run_id: string;
  next_scheduled_repair_due_at: string;
}

export interface ResearchContinuitySettingsRepository {
  getWorkspaceSettings(workspaceId: string): Promise<JsonRecord | null>;
  upsertWorkspaceSettings(
    input: ResearchContinuityWorkspaceSettingsUpsertInput,
  ): Promise<JsonRecord>;
  markScheduledRepairRun(
    input: ResearchContinuityMarkScheduledRepairRunInput,
  ): Promise<JsonRecord>;
}
```

- [ ] **Step 3: Add Postgres repository implementation**

Implement `getWorkspaceSettings`, `upsertWorkspaceSettings`, and
`markScheduledRepairRun` with parameterized SQL and `jsonb_build_object`
payloads, mirroring the V1.6 audit repository style.

- [ ] **Step 4: Register provider**

Update `research-continuity.module.ts` to provide the settings repository token.

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: both pass.

### Task 3: Add Settings And Scheduler API Logic

**Files:**

- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Modify: `apps/api/src/research-continuity/research-continuity.controller.ts`
- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing API tests**

Add tests for:

```text
GET /research-continuity/settings returns defaults without creating a row.
PATCH /research-continuity/settings requires admin access.
PATCH rejects enabled mode with skipped_or_degraded.
PATCH stores dry_run mode with all three case types.
GET /research-continuity/scheduler returns due=false when disabled.
POST /research-continuity/scheduler/run-due skips disabled settings.
POST /research-continuity/scheduler/run-due creates a dry-run repair history row when due.
POST /research-continuity/scheduler/run-due is idempotent for the same due time.
```

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because endpoints are missing.

- [ ] **Step 2: Add service methods**

Add methods:

```ts
getWorkspaceSettings(userId?: string, workspaceHeader?: string)
updateWorkspaceSettings(dto, userId?: string, workspaceHeader?: string)
getSchedulerStatus(userId?: string, workspaceHeader?: string)
runDueScheduledRepair(userId?: string, workspaceHeader?: string)
```

All four methods require admin access.

- [ ] **Step 3: Add controller routes**

Add:

```ts
@Get('settings')
@Patch('settings')
@Get('scheduler')
@Post('scheduler/run-due')
```

Use the existing `x-user-id` and `x-workspace-id` header pattern.

- [ ] **Step 4: Implement scheduler run-due**

Implement `runDueScheduledRepair` so it:

```text
loads settings or defaults
returns skipped when disabled
returns skipped when not due
builds repair filters from settings
uses dry_run=true for dry_run mode
uses dry_run=false for enabled mode
uses idempotency_key research-continuity-scheduler:<workspace>:<due>
calls the existing repair execution path
updates last and next due metadata after success
```

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
```

Expected: both pass.

### Task 4: Add Operations Health Scheduler Fields

**Files:**

- Modify: `apps/api/src/operations/operations.service.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing operations health test**

Extend the existing operations health test to assert:

```ts
assert.equal(health.continuity.scheduled_repair_mode, 'dry_run');
assert.equal(health.continuity.scheduled_repair_due, true);
assert.equal(
  health.continuity.next_scheduled_repair_due_at,
  '2026-05-12T00:00:00.000Z',
);
```

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because health does not include scheduler fields.

- [ ] **Step 2: Extend operations service**

Load scheduler settings for the active workspace and add the four scheduler
fields to `continuity` health. If settings are unavailable, return disabled safe
defaults without failing the rest of health.

- [ ] **Step 3: Update generated/static contracts used by the repo**

Update the API/frontend contract files that are manually maintained in this
repo so web types match API responses.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Expected: both pass.

### Task 5: Add Web Services And UI Controls

**Files:**

- Modify: `apps/web/src/services/research-continuity.ts`
- Modify: `apps/web/src/services/query-keys.ts`
- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
- Modify: `apps/web/src/pages/OperationsPage.tsx`
- Modify: `apps/web/src/styles/index.css`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Add service wrappers**

Add wrappers for:

```ts
getResearchContinuitySettings(auth)
updateResearchContinuitySettings(request, auth)
getResearchContinuityScheduler(auth)
runDueResearchContinuityScheduler(auth)
```

- [ ] **Step 2: Add query keys**

Add stable keys:

```ts
researchContinuitySettings: () =>
  ['research-continuity-settings', queryIdentity()] as const,
researchContinuityScheduler: () =>
  ['research-continuity-scheduler', queryIdentity()] as const,
```

- [ ] **Step 3: Add scheduler control panel**

In the existing maintenance area, add a compact panel that renders:

```text
workspace id
mode segmented control
case type checkboxes
interval/lookback/limit inputs
save button
due status
run due repair button
last scheduled repair run id
```

Disable `skipped_or_degraded` when the selected mode is `enabled`.

- [ ] **Step 4: Wire mutations**

On save, call `PATCH /research-continuity/settings` and invalidate settings,
scheduler, operations health, and repair run queries. On run-due, call
`POST /research-continuity/scheduler/run-due` and invalidate scheduler,
operations health, repair runs, and entries.

- [ ] **Step 5: Add repair run detail inspection**

Extend the Recent Repair Runs list so each row has a compact inspect action.
When selected, call `GET /research-continuity/repair/runs/:id` and render:

```text
status
dry_run
requested_at
completed_at
filters
created_entry_ids
error_message
results table with run, case, action, entry id, state, reason/error
```

Do not create a new route. Keep the detail view inside the maintenance panel.

- [ ] **Step 6: Extend Operations page**

Display scheduler mode, due state, and next due time inside the existing
Continuity Health panel.

- [ ] **Step 7: Verify**

Run:

```powershell
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: all pass. Existing large chunk warning is acceptable if unchanged.

### Task 6: Final Verification And Docs

**Files:**

- Modify: `docs/features/research-continuity/v1.7/implementation-plan.md`
- Modify: `docs/features/research-continuity/README.md`
- Modify: `docs/features/README.md`

- [ ] **Step 1: Run implementation verification**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/api lint
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: all pass.

- [ ] **Step 2: Optional broader regression check**

Run:

```powershell
pnpm --filter @lunaperception/ai-service test
pnpm --filter @lunaperception/ai-service typecheck
```

Expected: both pass. If `ai-service` lint still reports unrelated ruff format
drift, document it separately instead of folding unrelated formatting into V1.7.

- [ ] **Step 3: Manual smoke**

Start the normal dev stack and verify:

```text
GET /research-continuity/settings
PATCH /research-continuity/settings mode=dry_run
GET /research-continuity/scheduler
POST /research-continuity/scheduler/run-due
Open /research-continuity?symbol=BTC%2FUSDT
Open /operations
```

Expected:

```text
settings are workspace-scoped
enabled mode cannot include skipped_or_degraded
dry-run scheduled repair creates durable repair history
repair run detail can be inspected from the maintenance panel
disabled scheduler does not create repair history
operations shows scheduler status
existing manual repair panel still works
```

- [ ] **Step 4: Update docs to implemented**

After implementation is complete, change V1.7 status from `goal-ready` to
`implemented`, add completion notes with exact validation commands, and update
the feature hub and registry.

## Definition Of Done

- Workspace scheduler settings are persisted in Postgres and mirrored in Prisma.
- No settings row returns safe default disabled settings.
- Settings APIs are admin-only and current-workspace-only.
- Enabled mode cannot include `skipped_or_degraded`.
- Dry-run mode can include `skipped_or_degraded`.
- Scheduler status reports due/not-due state for the current workspace.
- `run-due` never runs when disabled or not due.
- Due dry-run creates durable V1.6 repair history with `dry_run: true`.
- Due enabled run creates durable V1.6 repair history with `dry_run: false`.
- Repeated due execution uses idempotency and does not duplicate repair runs.
- Successful due execution advances next due time.
- Failed due execution does not advance next due time.
- Operations health includes safe scheduler fields.
- Research Continuity maintenance UI can view/update settings and run due repair.
- Research Continuity maintenance UI can inspect a repair run detail response.
- No automatic timer, queue, worker, or cron is added.

## Version Placement

```text
V1.6  Auditability, repair history, and operations health.
V1.7  Workspace scheduled repair controls with manual run-due execution.
V1.8+ Durable worker/cron integration only after V1.7 proves due logic and
      operator controls.
V2.x  Timeline, graph/node model, provenance explorer, and multi-symbol views.
```

Do not start V1.8 background automation until V1.7 settings, idempotency, and
manual run-due behavior are verified.
