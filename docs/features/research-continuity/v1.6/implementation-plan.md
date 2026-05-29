# Research Continuity V1.6 Auditability, Repair History, And Operational Trust Specification

> **For agentic workers:** This is the approved V1.6 scope spec. Before implementation, convert this into task-sized changes and keep the first implementation slice focused on auditability, repair history, and operations visibility only.

**Goal:** Make privileged Research Continuity debug access and repair operations durable, attributable, and visible to workspace operators before any scheduled/background repair work exists.

**Architecture:** V1.6 adds a small continuity-specific operation audit boundary beside the existing append-only continuity ledger. Normal continuity entries remain journal artifacts; debug access attempts and repair run envelopes become control-plane audit records. Operations health reads compact metrics from the ledger plus the new audit/history tables.

**Tech Stack:** NestJS API, TypeScript DTOs/contracts, Postgres SQL schema, Prisma schema metadata, colocated continuity audit repository, React Query, existing Research Continuity and Operations pages.

---

Last updated: 2026-05-29
Status: goal-ready

## One Outcome

V1.6 should answer the operational trust questions V1.5 exposed:

```text
Who tried to open a debug trace?
Was the request allowed or denied?
Who requested a repair run?
What filters did repair use?
What did repair create, skip, or fail?
Is the current workspace's continuity layer healthy enough to automate later?
```

The target is not a more impressive UI. The target is accountable privileged
access and accountable repair mutation.

## Scope

Implement these first:

- Debug access audit persistence for every `GET /research-continuity/entries/:id/debug`
  attempt.
- Durable repair run history for `POST /research-continuity/repair/run`,
  including dry runs.
- Admin read APIs for debug audits and repair run history.
- Compact Research Continuity metrics inside `/operations/health`.
- Small UI additions: current workspace visibility, a Continuity health panel,
  and recent repair runs in the existing maintenance area.

## Non-Goals

Do not implement:

- Scheduled repair.
- Workspace list/dropdown/member-management UI.
- Workspace debug settings.
- Audit retention policy.
- Generic audit framework for all domains.
- `JournalRepository` redesign.
- Shared database pool refactor.
- SQLite or AI-service schema changes.
- Graph, timeline, provenance explorer, semantic retrieval, or social sharing.
- PnL, Calibration, thesis correctness, or performance scoring changes.

Workspace debug settings and scheduled repair can follow after V1.6 audit and
history are verified.

## Current Code Context

Inspect these files first:

```text
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/operations/operations.service.ts
apps/api/src/database/postgres-schema.sql
packages/database/prisma/schema.prisma
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx
apps/web/src/pages/OperationsPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/operations.ts
apps/web/src/types/index.ts
```

Important existing behavior:

- Debug access is globally gated by `ENABLE_RESEARCH_CONTINUITY_DEBUG`.
- Debug access currently requires workspace `editor` access.
- Repair preview/run exists and repair entries are append-only.
- Repair run responses are currently immediate-only and not durable.
- Operations health is workspace-scoped and already covers providers, LLM,
  freshness, queues, monitoring, retention, and memo health.

## Data Model

Add these Postgres tables:

```sql
CREATE TABLE IF NOT EXISTS research_continuity_debug_access_audits (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    entry_id TEXT NOT NULL,
    research_run_id TEXT,
    symbol TEXT,
    requested_by_user_id TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'allowed',
            'disabled_by_policy',
            'missing_user',
            'missing_workspace',
            'workspace_denied',
            'permission_required',
            'entry_not_found',
            'audit_unavailable'
        )
    ),
    requested_at TIMESTAMPTZ NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_requested
ON research_continuity_debug_access_audits(workspace_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_entry
ON research_continuity_debug_access_audits(workspace_id, entry_id);

CREATE INDEX IF NOT EXISTS idx_research_continuity_debug_audits_workspace_decision
ON research_continuity_debug_access_audits(workspace_id, decision, requested_at DESC);
```

Do not add a foreign key from debug audits to
`research_continuity_entries(id)`. The table must record attempts against
missing/nonexistent entry IDs.

```sql
CREATE TABLE IF NOT EXISTS research_continuity_repair_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    requested_by_user_id TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    dry_run BOOLEAN NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('started', 'completed', 'completed_with_failures', 'failed')
    ),
    idempotency_key TEXT,
    filters_json JSONB NOT NULL,
    requested_count INTEGER NOT NULL DEFAULT 0,
    repaired_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_entry_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_workspace_requested
ON research_continuity_repair_runs(workspace_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_workspace_status
ON research_continuity_repair_runs(workspace_id, status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_continuity_repair_runs_idempotency
ON research_continuity_repair_runs(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

Mirror the table shapes in `packages/database/prisma/schema.prisma` so schema
metadata stays current. Do not touch SQLite schema in V1.6.

## Audit Repository Boundary

Add a small repository colocated with Research Continuity:

```text
apps/api/src/research-continuity/research-continuity-audit.types.ts
apps/api/src/research-continuity/research-continuity-audit.repository.ts
```

Use a dedicated provider token:

```ts
export const RESEARCH_CONTINUITY_AUDIT_REPOSITORY =
  Symbol('RESEARCH_CONTINUITY_AUDIT_REPOSITORY');
```

The Postgres implementation may open its own `pg.Pool` from `DATABASE_URL`,
matching current API patterns. Do not refactor the wider database layer or
`JournalRepository` in V1.6.

Required methods:

```ts
recordDebugAccessAudit(input): Promise<JsonRecord>;
listDebugAccessAudits(filters, workspaceId): Promise<JsonRecord[]>;

createRepairRun(input): Promise<JsonRecord>;
finalizeRepairRun(id, workspaceId, result): Promise<JsonRecord>;
getRepairRun(id, workspaceId): Promise<JsonRecord | null>;
listRepairRuns(filters, workspaceId): Promise<JsonRecord[]>;

getContinuityOperationsHealth(workspaceId, options): Promise<JsonRecord>;
```

Keep this repository specific to Research Continuity. Do not build a generic
audit framework until more domains need one.

## Debug Audit Behavior

Audit every request to:

```text
GET /research-continuity/entries/:id/debug
```

Denied paths are best-effort audited. If the audit insert fails on a denied
request, return the original deny response and do not expose debug payload.

Allowed path is strict:

```text
resolve policy/user/workspace/entry
record audit row with decision=allowed and reason=allowed
return redacted debug payload only if audit insert succeeds
```

If allowed audit insert fails, return a service error and do not return debug
data.

Reason mapping:

```text
debug disabled globally -> denied / disabled_by_policy
missing x-user-id -> denied / missing_user
missing x-workspace-id -> denied / missing_workspace
workspace membership denied -> denied / workspace_denied
workspace role below editor -> denied / permission_required
entry missing after permission passes -> denied / entry_not_found
success -> allowed / allowed
```

When global debug is disabled, do not query entry details or perform membership
checks. Record raw trimmed `entry_id`, `x-user-id`, and `x-workspace-id` where
available, then preserve the existing disabled response.

## Repair Run History Behavior

Only `POST /research-continuity/repair/run` creates repair history. Do not audit
`GET /research-continuity/repair/preview` in V1.6.

Repair flow:

```text
resolve user
resolve workspace
require admin access
normalize filters
create repair run audit envelope with status=started
discover candidates
execute dry-run or repair candidates
finalize audit run
return response with audit_run_id
```

If the audit envelope cannot be created, repair must not start. This applies to
both dry runs and real repair runs.

Run status:

```text
started
completed
completed_with_failures
failed
```

Use `completed_with_failures` when candidate-level failures occur but the run
processed candidates. Use `failed` for top-level failures such as discovery
failure or unexpected execution failure outside the per-candidate result path.

Store normalized filters in `filters_json`. Store the same
`ResearchContinuityRepairRunResultResponse[]` returned by the API in
`results_json`. Store `created_entry_ids_json` as a JSON array of created
continuity entry IDs. Store sanitized `error_message` only; do not store stack
traces.

Add optional `idempotency_key` to repair run requests. It is intended for
`dry_run: false` retries but is not required in V1.6. If present and a matching
workspace/key row exists, return the existing run history response.

Update `ResearchContinuityRepairRunResponse`:

```ts
interface ResearchContinuityRepairRunResponse {
  audit_run_id: string;
  dry_run: boolean;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  results: ResearchContinuityRepairRunResultResponse[];
}
```

## Admin Read APIs

Add workspace-scoped admin endpoints:

```text
GET /research-continuity/debug-audits
GET /research-continuity/repair/runs
GET /research-continuity/repair/runs/:id
```

All require `admin` access to the current `x-workspace-id`. Do not support
cross-workspace query in V1.6.

Debug audit filters:

```text
limit
entry_id
decision
reason
requested_by_user_id
```

Repair run filters:

```text
limit
status
dry_run
```

Use newest-first ordering and `limit` only. Do not add cursor pagination in
V1.6.

Repair run list responses should be compact and exclude `results`. Repair run
detail responses should include normalized filters and full results.

## Operations Health

Extend `/operations/health` with a `continuity` section scoped to the current
workspace:

```ts
interface OperationsContinuityHealthResponse {
  workspace_id: string;
  lookback_days: number;
  audit_available: boolean;
  missing_entries_recent: number;
  degraded_entries_recent: number;
  stale_symbols: number;
  last_repair_run_at: string | null;
  last_repair_status: string | null;
  repair_failures_24h: number;
  debug_access_24h: number;
  debug_denied_24h: number;
}
```

Use a 30-day default lookback for recent continuity entry health. This lookback
is not retention and must not delete or reset old reports. It only keeps
operations health focused on current system behavior instead of old legacy data.

If the audit repository is unavailable, `/operations/health` should still return
the rest of the health response and set `continuity.audit_available = false`
with safe zero/null audit-derived metrics.

## UI Scope

Update `/operations`:

- Add a compact Continuity Health panel.
- Show current workspace for the metrics.
- Show missing recent entries, degraded recent entries, stale symbols, last
  repair run, repair failures, debug accesses, and debug denials.

Update `/research-continuity`:

- Show current workspace clearly.
- In the existing maintenance repair area, add a small Recent Repair Runs list.
- Keep repair history UI summary-only in first pass; the detail endpoint exists
  for API inspection and later UI drilldown.

Do not build a full debug audit UI in V1.6. The admin endpoint is enough.

## Security And Privacy Rules

- Debug audits never store raw debug payloads.
- Repair runs never store stack traces.
- Debug audit `entry_id` is `TEXT NOT NULL` but not a foreign key.
- Debug audit `workspace_id` and `requested_by_user_id` are nullable so missing
  identity/workspace attempts can be recorded.
- Repair run `workspace_id` and `requested_by_user_id` are not nullable because
  repair history starts only after identity, workspace, and admin checks pass.
- Audit/history APIs are admin-only and current-workspace-only.
- Do not add IP address or user-agent capture in V1.6.

## Definition Of Done

- `research_continuity_debug_access_audits` and
  `research_continuity_repair_runs` exist in Postgres schema and Prisma schema.
- Debug disabled attempts are auditable without entry lookup.
- Missing user/workspace debug attempts are auditable when possible.
- Denied debug attempts preserve existing deny behavior.
- Allowed debug attempts cannot return payload unless the allowed audit row is
  persisted.
- Repair dry runs create durable repair run history.
- Real repair runs create durable repair history with created entry IDs and
  result summaries.
- Repair cannot start if its audit envelope cannot be created.
- Partial candidate failures result in `completed_with_failures`.
- Admin endpoints list debug audits, list repair runs, and fetch repair run
  detail for the current workspace only.
- Operations health includes continuity metrics for the current workspace.
- `/operations` and `/research-continuity` show the new compact operator
  visibility without adding a new major page.
- Existing compact read and debug redaction behavior from V1.5 remains intact.

## Test Plan

API tests:

- Debug disabled records denied audit with `disabled_by_policy` when possible.
- Missing `x-user-id` records denied audit with `missing_user`.
- Missing `x-workspace-id` records denied audit with `missing_workspace`.
- Workspace denied records denied audit with `workspace_denied`.
- Viewer role records denied audit with `permission_required`.
- Missing entry after permission passes records denied audit with
  `entry_not_found` and still returns 404.
- Allowed debug records audit before returning redacted payload.
- Allowed debug does not return payload if audit insert fails.
- Repair run fails before discovery/execution when audit envelope creation
  fails.
- Repair dry run creates a repair run row and returns `audit_run_id`.
- Real repair stores `created_entry_ids_json` and `results_json`.
- Candidate-level failure finalizes as `completed_with_failures`.
- Repair run list omits full results while detail includes them.
- Operations health returns continuity metrics scoped to the active workspace.

Web tests or verification:

- Typecheck catches new contract fields.
- Operations page renders the Continuity Health panel.
- Research Continuity page renders current workspace and recent repair runs.
- Existing repair panel behavior still works with the added `audit_run_id`.

Manual smoke:

```text
GET /research-continuity/entries/<id>/debug with debug disabled
GET /research-continuity/entries/<id>/debug as viewer
GET /research-continuity/entries/<id>/debug as editor/admin with debug enabled
POST /research-continuity/repair/run dry_run=true
POST /research-continuity/repair/run dry_run=false
GET /research-continuity/repair/runs
GET /research-continuity/repair/runs/<audit_run_id>
GET /operations/health
Open /operations
Open /research-continuity?symbol=BTC%2FUSDT
```

Verification commands:

```bash
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

## Suggested Implementation Order

1. Add schema and audit repository.
2. Add debug access audit persistence.
3. Add repair run audit/history.
4. Add audit/history read endpoints.
5. Add operations continuity health metrics.
6. Add compact UI surfaces.
7. Update API contracts, web type definitions, generated API client files used
   by the repo, and docs.

Keep each step separately testable. Do not begin scheduled repair until this
audit/history layer is merged and verified.
