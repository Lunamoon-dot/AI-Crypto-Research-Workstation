# Research Continuity V1.5 Compact Read Boundary And Explicit Debug Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Research Continuity compact by default while preserving explicit, permission-gated debug access for workspace users who need to audit the workflow trace.

**Architecture:** V1.5 is an API boundary and UX trust-model change. The append-only ledger and stored payloads remain intact, but default list/state/detail reads return compact summary and digest contracts instead of raw workflow fields. A separate debug route returns a redacted trace only when global debug access is enabled and the workspace-scoped user has the mapped permission.

**Tech Stack:** NestJS API, TypeScript DTOs/contracts, deterministic continuity mappers, workspace-scoped RBAC scaffold, React Router, React Query, generated web API client.

---

Last updated: 2026-05-29
Status: implemented

## Completion Notes

- Default Research Continuity read paths now return compact summary/detail
  contracts without raw `events`, `payload`, `writer_metadata`, or
  `snapshot_quality`.
- Entry detail now exposes quality, evidence, material event, and state
  transition digests.
- `GET /research-continuity/entries/:id/debug` is feature-flagged by
  `ENABLE_RESEARCH_CONTINUITY_DEBUG=true`, requires workspace `editor` access,
  and returns recursively redacted trace data only.
- The web list and run workspace views use compact summaries, and a dedicated
  `/research-continuity/entries/:id` detail page fetches debug data only after
  an explicit button click.
- Verification completed: `pnpm --filter @lunaperception/api test`,
  `pnpm --filter @lunaperception/web typecheck`, and
  `pnpm --filter @lunaperception/web build`. The web build retained the
  existing large chunk warning.

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1.5 end-to-end.

Read this document first:
docs/features/research-continuity/v1.5/implementation-plan.md

Objective:
- Enforce compact default Research Continuity reads at the backend boundary.
- Move raw continuity fields behind an explicit debug route.
- Add a detail digest response that is readable and trust-building without raw
  workflow payload dumps.
- Gate debug access with a global feature flag and workspace-scoped permission
  mapping.
- Redact debug payloads recursively before returning them.
- Update web routing so continuity list/detail are compact by default and debug
  is an explicit action.

Do not implement:
- A full login/session/user-management system.
- Workspace member management UI.
- Platform/operator support access.
- Public/social sharing or published-report endpoints.
- DB migrations, new columns, or rewriting old continuity entries.
- Automatic backfill, scheduled repair, graph/timeline UI, semantic retrieval,
  LLM prompt changes, Calibration, PnL, or market correctness evaluation.

Definition of done:
- Default list, state, run-continuity, and entry-detail responses do not expose
  raw `events`, `payload`, `writer_metadata`, or full `snapshot_quality`.
- Entry detail exposes `quality_explanation`, `evidence_digest`, and
  `material_events_digest`.
- `GET /research-continuity/entries/:id/debug` exists and is disabled unless
  `ENABLE_RESEARCH_CONTINUITY_DEBUG=true`.
- Debug disabled returns `403` with code `debug_access_disabled`.
- Debug enabled but insufficient workspace permission returns `403` with code
  `debug_permission_required`.
- Debug enabled and permitted returns a redacted debug response.
- Recursive redaction covers nested secret-like keys and large value caps.
- Legacy entries still produce compact/detail fallbacks without DB mutation.
- The web app removes raw JSON dumps from the continuity list and adds a
  dedicated entry detail route.
- Focused API tests, web typecheck, and web build pass.
```

## One Outcome

Make Research Continuity readable by default and auditable on purpose.

After V1.5, a normal workspace reader should see:

```text
What changed?
How reliable is this continuity entry?
What evidence is missing, stale, or observed?
Which material events support the summary?
Where can an authorized workspace user open the debug trace?
```

They should not see raw implementation artifacts unless they explicitly open a
debug route and have the workspace-scoped permission to do so.

## Trust Model

Default views optimize for comprehension, not secrecy. Raw workflow data is not
the source of user trust by itself.

Detail views provide enough provenance to evaluate quality:

```text
quality status
evidence coverage
missing/stale categories
material event digest
source run anchor
debug availability and policy reason
```

Debug views provide implementation and audit trace for authorized users inside
the same workspace.

V1.5 does not introduce platform/operator access to user data. `admin` and
`owner` in this repo mean workspace membership roles, not LunaCrypto operator
roles. If cloud support access is ever needed, it must be a separate explicit
feature with user opt-in, time limit, audit log, and revoke behavior.

## Version Placement

```text
V1     Baseline post-research continuity loop.
V1.0.1 Auto-run patch for JobsService and BullMQ worker paths.
V1.1   Snapshot quality, evidence trace, identity stability, MVP workspace.
V1.2   Research Evidence Contract.
V1.3   Repair and Backfill Control Layer.
V1.4   Thin Report Read Model.
V1.5   Compact Read Boundary and Explicit Debug Access.
V1.6+  Debug audit persistence, workspace debug settings, scheduled repair,
       richer operations, or dedicated report view columns.
V2.x   Timeline, graph/node model, provenance explorer, multi-symbol views, or
       public/published report model.
```

V1.5 must not change the ledger source of truth. It only changes what default
read surfaces expose.

## Decisions Already Made

- Private workspace/team RBAC is the target model for V1.5.
- Public/social sharing is out of scope and should use a separate published
  report model later.
- Default API reads must be compact by backend enforcement, not only hidden in
  the UI.
- `GET /research-continuity/symbols/:symbol/entries` returns compact summaries.
- `GET /research-continuity/symbols/:symbol/state` returns compact latest entry.
- `GET /research-runs/:id/continuity` returns compact run continuity.
- `GET /research-continuity/entries/:id` returns detail digest, not raw debug.
- `GET /research-continuity/entries/:id/debug` returns redacted debug trace.
- `include_debug=true` is not the main V1.5 API surface.
- The debug route is disabled unless
  `ENABLE_RESEARCH_CONTINUITY_DEBUG=true`.
- Permission language should be capability-oriented:
  `view_debug_trace`.
- V1.5 maps `view_debug_trace` through the existing workspace role scaffold.
- `viewer` can read compact list/detail but not debug.
- `editor` can read redacted debug when the global flag is enabled.
- `admin` and `owner` are workspace roles and satisfy `editor` checks.
- V1.5 does not build a complete user system.
- V1.5 does not add member-management or debug-policy UI.
- V1.5 uses a small shared redaction helper instead of ad hoc field removal.
- Default responses must exclude raw `events`, `payload`, `writer_metadata`,
  and full `snapshot_quality`.
- Detail responses should include digest fields that explain trust and quality.
- Legacy entries get runtime fallback without DB write-back.

## API Contract

### Summary Response

Use for:

```text
GET /research-runs/:id/continuity
GET /research-continuity/symbols/:symbol/state latest_entry
GET /research-continuity/symbols/:symbol/entries entries[]
```

Shape:

```ts
export interface ResearchContinuityDebugAccessResponse {
  available: boolean;
  reason:
    | 'available'
    | 'disabled_by_policy'
    | 'permission_required'
    | 'not_available';
  requires_permission: 'view_debug_trace';
  url: string | null;
  redacted: true;
}

export interface ResearchContinuityEntrySummaryResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  entry_type: 'baseline' | 'delta' | 'degraded' | 'skipped';
  status: 'completed' | 'degraded' | 'skipped' | 'failed';
  generated_at: string | null;
  summary: string;
  thin_report: ResearchContinuityThinReport | null;
  debug: ResearchContinuityDebugAccessResponse;
}
```

Must not include:

```text
sections
events
snapshot_quality
source_run_ids
writer_metadata
payload
```

### Detail Response

Use for:

```text
GET /research-continuity/entries/:id
```

Shape:

```ts
export interface ResearchContinuityQualityExplanationResponse {
  status: string;
  score: number | null;
  observed_evidence_coverage: number | null;
  evidence_coverage: number | null;
  provenance_status: string | null;
  warnings: string[];
  reasons: string[];
}

export interface ResearchContinuityEvidenceDigestResponse {
  observed_count: number | null;
  reasoning_count: number | null;
  missing_count: number | null;
  no_evidence_count: number | null;
  stale_count: number | null;
  observed_coverage: number | null;
  missing_categories: string[];
  stale_categories: string[];
  health_line: string;
}

export interface ResearchContinuityMaterialEventDigestResponse {
  type: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  evidence_status: string | null;
}

export interface ResearchContinuityStateTransitionDigestResponse {
  previous_entry_id: string | null;
  current_snapshot_id: string | null;
  source_run_ids: string[];
  transition: 'baseline' | 'delta' | 'degraded' | 'skipped';
  reason: string;
}

export interface ResearchContinuityEntryDetailResponse
  extends ResearchContinuityEntrySummaryResponse {
  quality_explanation: ResearchContinuityQualityExplanationResponse;
  evidence_digest: ResearchContinuityEvidenceDigestResponse;
  material_events_digest: ResearchContinuityMaterialEventDigestResponse[];
  state_transition: ResearchContinuityStateTransitionDigestResponse;
}
```

Detail must not include raw:

```text
events
payload
writer_metadata
snapshot_quality
workflow/session/tool payloads
source artifact blobs
```

### Debug Response

Use for:

```text
GET /research-continuity/entries/:id/debug
```

Shape:

```ts
export interface ResearchContinuityEntryDebugResponse {
  id: string | null;
  workspace_id: string;
  symbol: string;
  research_run_id: string;
  generated_at: string | null;
  debug_view: 'redacted';
  redacted: true;
  requested_by_user_id: string;
  returned_at: string;
  entry: {
    sections: ContinuitySectionResponse[];
    events: JsonRecord[];
    snapshot_quality: JsonRecord;
    source_run_ids: string[];
    writer_metadata: JsonRecord;
    payload: JsonRecord;
  };
}
```

The debug response is redacted recursively. V1.5 does not add a raw
unredacted route.

## Error Contract

When global debug access is disabled:

```json
{
  "statusCode": 403,
  "message": "Research continuity debug access is disabled by policy.",
  "code": "debug_access_disabled"
}
```

When the user is authenticated but lacks the workspace permission:

```json
{
  "statusCode": 403,
  "message": "Research continuity debug access requires view_debug_trace.",
  "code": "debug_permission_required"
}
```

## Permission Mapping

V1.5 uses permission wording in contracts but maps through existing workspace
roles:

```text
view_research_continuity_summary -> viewer
view_research_continuity_detail  -> viewer
view_debug_trace                 -> editor
```

This means existing `WorkspacesService.assertAccess(user, workspaceId,
'editor')` is enough for the V1.5 debug route. Do not add member-management UI
or a permissions table in this version.

## Environment Config

Add a small config helper instead of reading `process.env` throughout service
code:

```ts
export function isResearchContinuityDebugEnabled(): boolean {
  return process.env.ENABLE_RESEARCH_CONTINUITY_DEBUG === 'true';
}
```

Recommended environment behavior:

```text
production default: off unless explicitly set true
local/dev: may be enabled in local env for manual audit testing
```

Do not enable debug access by default from code.

## Relevant Context

Supporting docs:

- [docs/features/research-continuity/README.md](../README.md)
- [docs/features/research-continuity/v1.3/implementation-plan.md](../v1.3/implementation-plan.md)
- [docs/features/research-continuity/v1.4/implementation-plan.md](../v1.4/implementation-plan.md)

Files to inspect first:

```text
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/workspaces/workspaces.service.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/routes/index.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/styles/index.css
```

Likely files to change:

```text
apps/api/src/common/redaction.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx
apps/web/src/routes/index.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/styles/index.css
docs/features/research-continuity/v1.5/implementation-plan.md
docs/features/research-continuity/README.md
docs/features/README.md
```

## Implementation Tasks

### Task 1: API Compact And Detail Types

**Files:**

- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing response-shape tests**

Add tests that generate or load a continuity entry and assert list/detail
boundary behavior:

```ts
const list = await continuity.listSymbolEntries(
  'BTC/USDT',
  { limit: 10 },
  'local-user',
  'local',
);
const entrySummary = list.entries[0] as Record<string, unknown>;
assert.ok(entrySummary.thin_report);
assert.equal('events' in entrySummary, false);
assert.equal('payload' in entrySummary, false);
assert.equal('writer_metadata' in entrySummary, false);
assert.equal('snapshot_quality' in entrySummary, false);

const detail = await continuity.getEntry(
  String(entrySummary.id),
  'local-user',
  'local',
);
const detailRecord = detail as Record<string, unknown>;
assert.ok(detail.quality_explanation);
assert.ok(detail.evidence_digest);
assert.ok(Array.isArray(detail.material_events_digest));
assert.equal('events' in detailRecord, false);
assert.equal('payload' in detailRecord, false);
assert.equal('writer_metadata' in detailRecord, false);
assert.equal('snapshot_quality' in detailRecord, false);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because current responses still expose raw continuity fields and
do not expose detail digest fields.

- [ ] **Step 3: Add DTO interfaces**

Add interfaces from the API Contract section to
`research-continuity.dto.ts`. Keep `ResearchContinuityEntryResponse` only as an
internal legacy/raw entry shape where stored-entry mapping needs it. Public read
methods and the generate/write response should use summary/detail/debug types.

- [ ] **Step 4: Add a debug affordance type**

Add:

```ts
export const RESEARCH_CONTINUITY_DEBUG_PERMISSION = 'view_debug_trace' as const;
```

Use that constant for `requires_permission` fields so tests and generated
contracts do not drift.

- [ ] **Step 5: Run API type/test command**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: TypeScript compiles after interface additions, but response-shape
tests still fail until mappers are changed.

### Task 2: Redaction Helper

**Files:**

- Create: `apps/api/src/common/redaction.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing redaction tests**

Add a focused test that imports the helper and verifies nested redaction:

```ts
const redacted = redactForDebug({
  authorization: 'Bearer abc',
  nested: {
    api_key: 'secret',
    token: 'tok',
    safe: 'keep',
  },
  list: [{ cookie: 'session=abc' }],
});

assert.equal(redacted.authorization, '[REDACTED]');
assert.equal((redacted.nested as JsonRecord).api_key, '[REDACTED]');
assert.equal((redacted.nested as JsonRecord).token, '[REDACTED]');
assert.equal((redacted.nested as JsonRecord).safe, 'keep');
assert.equal(
  ((redacted.list as JsonRecord[])[0] as JsonRecord).cookie,
  '[REDACTED]',
);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because `redactForDebug` does not exist.

- [ ] **Step 3: Implement recursive redaction**

Create `apps/api/src/common/redaction.ts` with:

```ts
import { JsonRecord } from '../database/journal.types';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|token|secret|password|cookie|set-cookie|credential|private[_-]?key)/i;

export function redactForDebug(value: unknown): unknown {
  return redactValue(value, 0);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return TRUNCATED;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1),
      ]),
    );
  }
  if (typeof value === 'string' && value.length > 5000) {
    return `${value.slice(0, 5000)}${TRUNCATED}`;
  }
  return value;
}
```

- [ ] **Step 4: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: redaction helper tests pass.

### Task 3: Compact And Detail Response Mappers

**Files:**

- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing digest assertions**

Assert detail response has bounded digest arrays and fallback text:

```ts
assert.ok(detail.evidence_digest.health_line.length > 0);
assert.ok(detail.material_events_digest.length <= 10);
assert.ok(detail.state_transition.reason.length > 0);
assert.equal(detail.debug.requires_permission, 'view_debug_trace');
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because digest mappers do not exist.

- [ ] **Step 3: Keep legacy mapper internal**

Rename the current `toEntryResponse()` behavior to an internal mapper such as:

```ts
function toLegacyEntryResponse(entry: JsonRecord): ResearchContinuityEntryResponse {
  // Move the current full response mapping here unchanged.
}
```

Use this only where full internal compatibility is necessary during generation.

- [ ] **Step 4: Add summary mapper**

Add:

```ts
function toEntrySummaryResponse(
  entry: JsonRecord,
): ResearchContinuityEntrySummaryResponse {
  const payload = continuityEntryPayload(entry);
  return {
    id: nullableString(entry.id),
    workspace_id: stringValue(entry.workspace_id, 'local'),
    symbol: stringValue(entry.symbol),
    research_run_id: stringValue(entry.research_run_id),
    entry_type: entryTypeValue(entry.entry_type),
    status: entryStatusValue(entry.status),
    generated_at: nullableString(entry.generated_at),
    summary: stringValue(entry.summary),
    thin_report:
      thinReportFromPayload(payload) ??
      buildLegacyThinReport({
        generatedAt: nullableString(entry.generated_at),
        sections: arrayRecords(entry.sections),
        snapshotQuality: recordValue(entry.snapshot_quality),
      }),
    debug: buildDebugAccess(nullableString(entry.id)),
  };
}
```

- [ ] **Step 5: Add detail mapper**

Add:

```ts
function toEntryDetailResponse(
  entry: JsonRecord,
): ResearchContinuityEntryDetailResponse {
  return {
    ...toEntrySummaryResponse(entry),
    quality_explanation: buildQualityExplanation(entry),
    evidence_digest: buildEvidenceDigest(entry),
    material_events_digest: buildMaterialEventsDigest(entry),
    state_transition: buildStateTransitionDigest(entry),
  };
}
```

- [ ] **Step 6: Add deterministic digest builders**

Implement helpers in the same service file unless they become large enough to
justify a focused mapper file:

```ts
function buildQualityExplanation(entry: JsonRecord): ResearchContinuityQualityExplanationResponse;
function buildEvidenceDigest(entry: JsonRecord): ResearchContinuityEvidenceDigestResponse;
function buildMaterialEventsDigest(entry: JsonRecord): ResearchContinuityMaterialEventDigestResponse[];
function buildStateTransitionDigest(entry: JsonRecord): ResearchContinuityStateTransitionDigestResponse;
```

Rules:

```text
quality_explanation reads snapshot_quality first, then thin_report.quality.
evidence_digest reads observed/reasoning/missing/no-evidence/stale counts when
present and falls back to a concise unknown health line.
material_events_digest reads raw events internally and emits at most 10
user-facing items.
state_transition reads previous_entry_id, current_snapshot_id, source_run_ids,
entry_type, and status.
```

- [ ] **Step 7: Update read methods**

Change read methods:

```text
getRunContinuity -> ResearchContinuityEntrySummaryResponse | null
getSymbolState latest_entry -> ResearchContinuityEntrySummaryResponse | null
listSymbolEntries entries[] -> ResearchContinuityEntrySummaryResponse[]
getEntry -> ResearchContinuityEntryDetailResponse
```

Make `generateForRun` return `ResearchContinuityEntryDetailResponse` so the
write endpoint follows the same compact public boundary as detail reads.

- [ ] **Step 8: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: compact/detail response-shape tests pass.

### Task 4: Debug Feature Flag And Route

**Files:**

- Modify: `apps/api/src/research-continuity/research-continuity.controller.ts`
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing disabled-policy test**

Set the env flag to false for the test and assert:

```ts
function hasForbiddenCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof ForbiddenException)) {
      return false;
    }
    const response = error.getResponse();
    const record =
      response && typeof response === 'object'
        ? (response as Record<string, unknown>)
        : {};
    return record.code === code;
  };
}

process.env.ENABLE_RESEARCH_CONTINUITY_DEBUG = 'false';
await assert.rejects(
  () => continuity.getEntryDebug(entryId, 'local-user', 'local'),
  hasForbiddenCode('debug_access_disabled'),
);
```

- [ ] **Step 2: Add failing permission test**

Set memberships so the user is a `viewer`, enable debug, and assert:

```ts
process.env.ENABLE_RESEARCH_CONTINUITY_DEBUG = 'true';
workspaces.setMembershipsForTest([
  { user_id: 'viewer-user', workspace_id: 'local', role: 'viewer' },
]);
await assert.rejects(
  () => continuity.getEntryDebug(entryId, 'viewer-user', 'local'),
  hasForbiddenCode('debug_permission_required'),
);
```

- [ ] **Step 3: Add failing permitted debug test**

Set membership to `editor`, enable debug, and assert redacted fields:

```ts
process.env.ENABLE_RESEARCH_CONTINUITY_DEBUG = 'true';
workspaces.setMembershipsForTest([
  { user_id: 'editor-user', workspace_id: 'local', role: 'editor' },
]);

const debug = await continuity.getEntryDebug(entryId, 'editor-user', 'local');
assert.equal(debug.debug_view, 'redacted');
assert.equal(debug.redacted, true);
assert.equal(debug.requested_by_user_id, 'editor-user');
assert.ok(debug.entry.payload);
assert.equal(JSON.stringify(debug).includes('super-secret-token'), false);
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because route/service method and errors do not exist.

- [ ] **Step 5: Add debug access exception helpers**

Use Nest exceptions with stable response body:

```ts
throw new ForbiddenException({
  code: 'debug_access_disabled',
  message: 'Research continuity debug access is disabled by policy.',
});
```

and:

```ts
throw new ForbiddenException({
  code: 'debug_permission_required',
  message: 'Research continuity debug access requires view_debug_trace.',
});
```

- [ ] **Step 6: Add service method**

Add:

```ts
async getEntryDebug(
  id: string,
  userId?: string,
  workspaceHeader?: string,
): Promise<ResearchContinuityEntryDebugResponse> {
  if (!isResearchContinuityDebugEnabled()) {
    throwDebugDisabled();
  }
  const workspaceId = await this.resolveWorkspaceAccess(
    userId,
    workspaceHeader,
    'editor',
  ).catch((error) => {
    throwDebugPermissionRequired(error);
  });
  const entry = await this.journal.getResearchContinuityEntry(id, workspaceId);
  if (!entry) {
    throw new NotFoundException(`Research continuity entry ${id} not found`);
  }
  return toEntryDebugResponse(entry, this.auth.resolveUser(userId));
}
```

Keep the exact error handling simple and make sure missing entries still return
`404` after the debug policy and permission checks pass.

- [ ] **Step 7: Add controller route**

Add:

```ts
@Get('entries/:id/debug')
getEntryDebug(
  @Param('id') id: string,
  @Headers('x-user-id') userId?: string,
  @Headers('x-workspace-id') workspaceId?: string,
) {
  return this.continuity.getEntryDebug(id, userId, workspaceId);
}
```

- [ ] **Step 8: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: debug route tests pass.

### Task 5: OpenAPI And Generated Client Contracts

**Files:**

- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add OpenAPI contract assertions**

In the existing contract tests, assert:

```ts
assert.ok(
  document.paths['/research-continuity/entries/{id}/debug']?.get,
);
assert.ok(
  document.components.schemas.ResearchContinuityEntrySummaryResponse,
);
assert.ok(
  document.components.schemas.ResearchContinuityEntryDetailResponse,
);
assert.ok(
  document.components.schemas.ResearchContinuityEntryDebugResponse,
);
```

- [ ] **Step 2: Run contract test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because contracts are not updated.

- [ ] **Step 3: Update OpenAPI manually if that remains the repo workflow**

The existing repo stores `openapi.generated.ts` as source. Add schemas for the
new summary/detail/debug types and change operation responses:

```text
/research-runs/{id}/continuity -> ResearchContinuityEntrySummaryResponse nullable
/research-continuity/symbols/{symbol}/state -> latest_entry summary
/research-continuity/symbols/{symbol}/entries -> entries summary[]
/research-continuity/entries/{id} -> ResearchContinuityEntryDetailResponse
/research-continuity/entries/{id}/debug -> ResearchContinuityEntryDebugResponse
```

- [ ] **Step 4: Update frontend types**

Mirror API DTOs in `apps/web/src/types/index.ts`. Keep
`ResearchContinuityEntryResponse` only if another existing frontend call still
needs it after the migration.

- [ ] **Step 5: Update generated client**

Change the generated client return types and add:

```ts
getResearchContinuityEntryDebug: (id: string) =>
  request<ResearchContinuityEntryDebugResponse>(
    `/research-continuity/entries/${encodeURIComponent(id)}/debug`,
    {},
  ),
```

- [ ] **Step 6: Run API tests and web typecheck**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Expected: API contract tests pass; web may still fail until UI code migrates in
the next task.

### Task 6: Web Detail Route And Compact List UI

**Files:**

- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
- Create: `apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/services/research-continuity.ts`
- Modify: `apps/web/src/services/query-keys.ts`
- Modify: `apps/web/src/styles/index.css`

- [ ] **Step 1: Update service exports**

Expose:

```ts
export function getResearchContinuityEntry(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityEntry(id);
}

export function getResearchContinuityEntryDebug(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityEntryDebug(id);
}
```

- [ ] **Step 2: Add query keys**

Add:

```ts
researchContinuityEntry: (id: string) =>
  ['research-continuity-entry', queryIdentity(), id] as const,
researchContinuityEntryDebug: (id: string) =>
  ['research-continuity-entry-debug', queryIdentity(), id] as const,
```

- [ ] **Step 3: Add route**

Add import and route:

```tsx
import { ResearchContinuityEntryDetailPage } from '@/pages/ResearchContinuityEntryDetailPage';

{ path: 'research-continuity/entries/:id', element: <ResearchContinuityEntryDetailPage /> },
```

- [ ] **Step 4: Update list row links**

Replace raw JSON `<details><JsonView value={entry} /></details>` in
`ResearchContinuityPage.tsx` with:

```tsx
<Link className="button" to={`/research-continuity/entries/${entry.id}`}>
  Details
</Link>
```

Keep `research_run_id` as the source-run anchor, but label it:

```tsx
Open source run
```

- [ ] **Step 5: Create detail page**

The detail page should:

```text
load getResearchContinuityEntry(id)
render summary and thin_report sections
render quality_explanation
render evidence_digest
render material_events_digest
render state_transition
show Debug trace button only when detail.debug.available is true
fetch debug only after explicit button click
render debug JSON in a collapsed panel after the explicit fetch succeeds
```

The page must not render `JsonView value={detail}` for the default detail
response.

- [ ] **Step 6: Run web typecheck**

Run:

```powershell
pnpm --filter @lunaperception/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Run web build**

Run:

```powershell
pnpm --filter @lunaperception/web build
```

Expected: PASS. Existing Vite large chunk warnings are acceptable if unchanged.

### Task 7: Legacy Fallback And Boundary Regression Tests

**Files:**

- Modify: `apps/api/test/api-contract.test.ts`
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`

- [ ] **Step 1: Add legacy compact fallback test**

Seed or fake an old entry with `sections` and `snapshot_quality` but no
`payload.report_views.thin`. Assert:

```ts
const detail = await continuity.getEntry(
  'continuity_old_without_thin',
  'local-user',
  'local',
);
assert.equal(detail.thin_report?.version, 'research_continuity_thin.v1');
assert.ok(detail.quality_explanation.status.length > 0);
assert.ok(detail.evidence_digest.health_line.length > 0);
assert.equal(
  (detail as Record<string, unknown>).payload,
  undefined,
);
```

- [ ] **Step 2: Add no-read-path-write-back assertion**

After reading the legacy entry, reload raw repository entry and assert:

```ts
const raw = await journal.getResearchContinuityEntry(
  'continuity_old_without_thin',
  'local',
);
assert.equal(
  recordValue(raw?.payload).report_views,
  undefined,
);
```

- [ ] **Step 3: Run API tests and verify failures**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL until fallback mappers are complete.

- [ ] **Step 4: Complete fallback behavior**

Make summary/detail mappers use the existing `buildLegacyThinReport()` fallback
and digest fallback helpers without mutating the stored payload.

- [ ] **Step 5: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: legacy fallback tests pass.

### Task 8: Docs Status And Final Verification

**Files:**

- Modify: `docs/features/research-continuity/v1.5/implementation-plan.md`
- Modify: `docs/features/research-continuity/README.md`
- Modify: `docs/features/README.md`

- [ ] **Step 1: Run full validation**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: all commands pass. If web build reports the existing large chunk
warning only, record it as unchanged.

- [ ] **Step 2: Optional manual UI smoke**

Run the local app using the repo's normal dev command, then open:

```text
/research-continuity?symbol=BTC%2FUSDT
/research-continuity/entries/<entry-id>
```

Confirm:

```text
list page has no raw JSON details
detail page shows digest sections
debug button is hidden or disabled when debug is unavailable
debug route returns 403 when disabled
debug route returns redacted trace when enabled and user has editor role
```

- [ ] **Step 3: Update docs to implemented**

After implementation is complete, change this document status from
`goal-ready` to `implemented`, add completion notes, and update the Research
Continuity hub and feature registry to point at V1.5 as implemented.

- [ ] **Step 4: Commit**

Stage only V1.5-related files:

```powershell
git add docs/features/research-continuity/v1.5/implementation-plan.md docs/features/research-continuity/README.md docs/features/README.md
git add apps/api/src/common/redaction.ts apps/api/src/research-continuity apps/api/src/contracts/openapi.generated.ts apps/api/test/api-contract.test.ts
git add apps/web/src/pages apps/web/src/routes apps/web/src/services apps/web/src/types apps/web/src/styles/index.css
git commit -m "feat: enforce research continuity compact reads"
```

## Validation Commands

Minimum implementation verification:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Optional manual API checks:

```powershell
$env:ENABLE_RESEARCH_CONTINUITY_DEBUG='false'
# GET /research-continuity/entries/<id>/debug should return 403 debug_access_disabled

$env:ENABLE_RESEARCH_CONTINUITY_DEBUG='true'
# viewer role should return 403 debug_permission_required
# editor role should return redacted debug response
```

## Non-Goals

- No full user/login/session system.
- No member-management UI.
- No workspace debug settings UI.
- No platform/operator support access.
- No public/social report sharing.
- No DB schema migration.
- No deletion, trimming, or rewriting existing ledger entries.
- No read-path write-back for legacy fallbacks.
- No automatic backfill or scheduled repair.
- No graph/timeline/provenance explorer.
- No AI prompt, AI-service schema, embedding, or semantic retrieval work.
- No Calibration, thesis outcome scoring, PnL, or market correctness evaluation.
- No unredacted raw debug route in V1.5.

## Stop Rules

Stop and report instead of expanding scope when:

- enforcing debug permission requires a complete user system;
- a required check needs member-management UI;
- redaction requires a broad data-loss-prevention framework;
- OpenAPI generation workflow contradicts manual contract updates;
- compact responses would require mutating stored continuity entries;
- implementation needs AI-service prompt/schema changes;
- implementation starts touching public/social sharing;
- validation fails for external environment reasons.

## Required Tests

API:

- [ ] List entries excludes raw `events`, `payload`, `writer_metadata`, and
      `snapshot_quality`.
- [ ] Symbol state latest entry excludes raw fields.
- [ ] Run continuity read excludes raw fields.
- [ ] Entry detail excludes raw fields.
- [ ] Generate/write response excludes raw fields.
- [ ] Entry detail includes quality, evidence, material events, and state
      transition digests.
- [ ] Debug disabled returns `403` with `debug_access_disabled`.
- [ ] Debug enabled plus viewer returns `403` with
      `debug_permission_required`.
- [ ] Debug enabled plus editor returns redacted debug response.
- [ ] Redaction covers nested `api_key`, `authorization`, `token`, `secret`,
      `password`, `cookie`, `credential`, and `private_key`.
- [ ] Large strings, arrays, and objects are capped in debug output and mark
      omitted content.
- [ ] Legacy entry fallback produces compact/detail response without DB
      mutation.

Web:

- [ ] Continuity list compiles against summary response type.
- [ ] Continuity list links to `/research-continuity/entries/:id`.
- [ ] Continuity list no longer renders raw `JsonView value={entry}`.
- [ ] Detail page renders digest sections.
- [ ] Debug fetch happens only after explicit user action.
- [ ] Debug unavailable state is visible without raw payload exposure.
- [ ] Web typecheck and build pass.

## Self-Review

- Spec coverage: V1.5 covers compact default reads, detail digest, explicit
  debug route, env flag, workspace-scoped permission language, redaction,
  legacy fallback, web detail route, and negative boundary tests.
- Placeholder scan: the plan contains no banned placeholder tokens,
  placeholder implementation steps, or undefined API names without a task that
  introduces them.
- Type consistency: response names use `Summary`, `Detail`, and `Debug`
  consistently across DTO, OpenAPI, generated client, and web tasks.

## Execution Handoff

Plan complete and saved to:

```text
docs/features/research-continuity/v1.5/implementation-plan.md
```

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans,
   batch execution with checkpoints for review.
