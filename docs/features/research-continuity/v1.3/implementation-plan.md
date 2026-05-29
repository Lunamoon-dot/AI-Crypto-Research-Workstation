# Research Continuity V1.3 Repair And Backfill Control Implementation Plan

Last updated: 2026-05-28
Status: shipped

V1.3 adds explicit operational control for Research Continuity history after the
V1.2 evidence contract. V1.2 made snapshots and tracked items more trustworthy,
but existing continuity entries can still be missing, skipped, degraded, or
legacy entries without V1.2 evidence quality. V1.3 should detect those cases and
repair them in a controlled, append-only way.

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1.3 end-to-end.

Read this document first:
docs/features/research-continuity/v1.3/implementation-plan.md

Objective:
- Add a manual, idempotent repair and backfill control layer for Research
  Continuity so missing, skipped/degraded, and legacy-evidence continuity
  records can be discovered, previewed, and repaired without rewriting history.

Required behavior:
- Add preview and run APIs for continuity repair/backfill.
- Detect three deterministic candidate types:
  missing_continuity, skipped_or_degraded, and legacy_evidence.
- Default to dry-run/preview behavior and require an explicit execute request to
  write repair entries.
- Create append-only repair/backfill entries with audit metadata instead of
  overwriting existing entries.
- Make repair idempotent so repeated run requests do not duplicate entries.
- Keep state projection from moving backward when repairing historical runs.
- Add a small MVP repair panel to `/research-continuity`.
- Add focused API and web contract tests around candidate discovery, dry-run,
  idempotency, state projection, and UI/service contracts.

Do not implement:
- Automatic repair on app boot, page load, or after every research run.
- Scheduled repair jobs, queues, or background workers.
- New LLM agents, semantic merge, embeddings, graph/node model, or timeline UI.
- Calibration, PnL, market correctness, or thesis outcome evaluation.
- Research core or AI-service prompt/schema changes unless fixing a confirmed
  V1.2 compatibility bug.
- DB schema reset, data deletion workflow, or historical overwrite behavior.
- A separate repair audit table unless existing JSON metadata cannot support
  idempotency and audit requirements.

Definition of done:
- Preview returns eligible and ineligible repair candidates for the three V1.3
  case types with clear reasons.
- Run with dry-run writes nothing and returns the same candidate/action shape.
- Run with explicit execution creates append-only repair entries with audit
  metadata.
- Re-running the same repair request returns `already_repaired` or
  `already_has_continuity` without duplicate ledger entries.
- State updates only when the repaired entry is the latest eligible completed
  run for the symbol, or when repairing the current state's own latest entry.
- Repair reports include a repair context while preserving the normal continuity
  report structure.
- `/research-continuity` can preview and run repair/backfill with a compact
  control panel.
- Required validation commands pass, or exact blockers are documented.
```

## One Outcome

Add a safe manual repair/backfill layer for Research Continuity.

After V1.3, an operator should be able to ask:

```text
Which completed research runs are missing continuity?
Which skipped/degraded entries can now be repaired?
Which old continuity entries lack V1.2 evidence quality?
What would be created if I ran repair?
Can I execute the repair without duplicating ledger entries?
```

The answer should come from deterministic API/service logic, not LLM judgment.

## Verifiable End State

- [x] `GET /research-continuity/repair/preview` exists and returns repair
      candidates without writing database rows.
- [x] `POST /research-continuity/repair/run` exists and defaults to dry-run or
      requires `dry_run: false` for writes.
- [x] Candidate discovery supports `missing_continuity`.
- [x] Candidate discovery supports `skipped_or_degraded`.
- [x] Candidate discovery supports `legacy_evidence`.
- [x] Repair execution creates append-only continuity entries and preserves old
      entries.
- [x] Repair entries include audit metadata identifying repair version, case
      type, source run, source entry, reason, execution source, and timestamp.
- [x] Repeating the same repair request is idempotent.
- [x] Repairing a historical run does not move `ContinuityState` backward.
- [x] Repairing the latest eligible run can update `ContinuityState` when the
      new entry passes quality gates.
- [x] Repair reports include a repair context section or header.
- [x] `/research-continuity` includes an MVP repair/backfill panel.
- [x] API build, API tests, web typecheck, and manual UI smoke pass, or
      blockers are documented.

Completion notes:

- Implemented in PR #7 (`research-continuity-v1.3`) and merged into `main`.
- Follow-up PR #8 hides the maintenance panel by default behind
  `VITE_ENABLE_RESEARCH_CONTINUITY_REPAIR=true` and requires `admin` access for
  repair preview/run APIs.
- Final validation during implementation: `pnpm build:api`,
  `pnpm --filter @lunaperception/api test`, `pnpm --filter @lunaperception/web
  typecheck`, `pnpm --filter @lunaperception/web build`, and local UI smoke.

## Version Placement

```text
V1     Baseline post-research continuity loop.
V1.0.1 Auto-run patch for JobsService and BullMQ worker paths.
V1.1   Snapshot quality, evidence trace, identity stability, MVP workspace.
V1.2   Research Evidence Contract.
V1.3   Repair and Backfill Control Layer.
V1.4+  Optional repair job audit table, scheduled repair, or richer operations.
V2.x   Timeline, graph/node model, provenance explorer, and multi-symbol views.
```

V1.3 should make continuity history controllable and trustworthy. It must not
become graph, analytics, calibration, or long-range intelligence work.

## Relevant Context

Supporting materials:

- [docs/goal-skill.md](../../../goal-skill.md)
- [docs/features/research-continuity/README.md](../README.md)
- [docs/features/research-continuity/v1/implementation-plan.md](../v1/implementation-plan.md)
- [docs/features/research-continuity/v1.1/implementation-plan.md](../v1.1/implementation-plan.md)
- [docs/features/research-continuity/v1.2/implementation-plan.md](../v1.2/implementation-plan.md)

Current repo facts:

- Research Continuity uses append-only entries plus a latest state projection.
- `ContinuityState` is a cache/projection and must not be treated as the full
  historical source of truth.
- V1.2 adds `evidence_contract_version: research_evidence.v1.2`,
  per-item `evidence_quality`, and evidence coverage metrics.
- Current public continuity entry types are `baseline`, `delta`, `degraded`,
  and `skipped`.
- V1.3 repair entries should prefer metadata such as `payload.repair` to mark
  repair/backfill behavior rather than forcing a new top-level entry type.
- The existing API has run-level continuity generation and symbol-level state
  reads, but no explicit repair/backfill control surface.

Files to inspect first:

```text
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-delta.engine.ts
apps/api/src/research-continuity/continuity-state.projector.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/types/index.ts
apps/web/src/services/query-keys.ts
```

Likely files to change:

```text
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/types/index.ts
apps/web/src/services/query-keys.ts
```

Do not touch AI-service unless implementation discovers a real V1.2 contract
bug that prevents existing research payloads from being read.

## Repair Case Types

V1.3 supports exactly three deterministic repair case types.

### missing_continuity

A completed research run has no continuity entry.

Eligible when:

```text
research_run.status is completed
no latest continuity entry exists for the run
snapshot builder can produce a snapshot or a clear skipped/degraded result
candidate is inside requested workspace/symbol/date/limit filters
```

Execution:

```text
create a new append-only continuity entry
mark payload.repair.case_type = missing_continuity
do not overwrite any existing entries
skip if another entry appeared after preview
```

### skipped_or_degraded

A research run has a latest continuity entry with status `skipped` or
`degraded`, and current artifacts/builder can now produce a better entry.

Eligible when:

```text
latest run entry status is skipped or degraded
source run still exists and belongs to workspace
snapshot builder can now produce a snapshot with completed quality, or quality
is materially better than the source entry
candidate is inside requested workspace/symbol/date/limit filters
```

Execution:

```text
create a new append-only repair entry
payload.repair.source_entry_id points to the skipped/degraded entry
state updates only if this run is latest eligible for the symbol
```

If repair still produces `skipped` or `degraded`, the result should be reported
as `not_improved` or `still_degraded` and should not update state.

### legacy_evidence

A run has a continuity entry created before V1.2 evidence quality, or its
snapshot/entry lacks V1.2 evidence metadata.

Eligible when any of these are true:

```text
payload.evidence_contract_version is missing or not research_evidence.v1.2
tracked_items exist but lack evidence_quality
snapshot_quality lacks observed/reasoning/missing/no-evidence metrics
entry payload is otherwise identifiable as pre-V1.2 continuity
```

Execution:

```text
regenerate snapshot/report using current V1.2 builder and renderer
create append-only repair entry with payload.repair.case_type = legacy_evidence
do not mutate the old snapshot or old entry
```

Legacy repair must not invent evidence. It only re-extracts and normalizes from
persisted research artifacts.

## API Contract

Add two admin-style endpoints under the existing controller:

```text
GET  /research-continuity/repair/preview
POST /research-continuity/repair/run
```

Use existing workspace auth patterns. Recommended access level:

```text
preview: admin
run: admin
```

Preview query parameters:

```ts
{
  symbol?: string;
  from?: string;
  to?: string;
  case_types?: string; // comma-separated
  limit?: string;
}
```

Run request body:

```ts
{
  symbol?: string;
  from?: string;
  to?: string;
  case_types: Array<
    'missing_continuity' | 'skipped_or_degraded' | 'legacy_evidence'
  >;
  limit: number;
  dry_run?: boolean;
}
```

Defaults and limits:

```text
default preview limit: 25
maximum preview/run limit: 100
run requires case_types and limit
run defaults dry_run to true unless explicitly false
dry_run false executes writes
```

Preview response:

```ts
{
  dry_run: true;
  candidate_count: number;
  candidates: Array<{
    candidate_id: string;
    run_id: string;
    symbol: string;
    run_completed_at: string | null;
    case_type:
      | 'missing_continuity'
      | 'skipped_or_degraded'
      | 'legacy_evidence';
    current_entry_id: string | null;
    current_entry_status: string | null;
    current_entry_type: string | null;
    eligible: boolean;
    reason: string;
    blocked_reason?: string | null;
    predicted_action:
      | 'create_repair_entry'
      | 'already_repaired'
      | 'already_has_continuity'
      | 'not_eligible'
      | 'not_improved';
    repair_version: 'research-continuity-v1.3';
  }>;
}
```

Run response:

```ts
{
  dry_run: boolean;
  requested_count: number;
  repaired_count: number;
  skipped_count: number;
  failed_count: number;
  results: Array<{
    candidate_id: string;
    run_id: string;
    symbol: string;
    case_type: string;
    action:
      | 'created_repair_entry'
      | 'already_repaired'
      | 'already_has_continuity'
      | 'dry_run'
      | 'not_eligible'
      | 'not_improved'
      | 'failed';
    previous_entry_id: string | null;
    new_entry_id: string | null;
    state_updated: boolean;
    reason: string;
    error?: string | null;
  }>;
}
```

Keep names aligned with existing DTO style if the repo already has equivalent
response naming conventions.

## Candidate Discovery Rules

Discovery should be deterministic and bounded by filters.

Minimum filters:

```text
workspace_id from auth/header
symbol optional
from optional run completion/created timestamp
to optional run completion/created timestamp
case_types optional for preview, required for execution
limit bounded
```

Candidate discovery may require repository helpers such as:

```text
listResearchRunsForContinuityRepair(filters, workspaceId)
listResearchContinuityEntriesForRuns(runIds, workspaceId)
findResearchContinuityRepairEntry(identity, workspaceId)
listResearchContinuityEntriesBeforeRun(symbol, completedAt, workspaceId)
```

Prefer focused repository methods over loading unbounded history into service
memory.

### Historical Previous Context

Do not generate a historical repair using the current latest state as previous
context unless the repaired run is actually the latest eligible run for the
symbol.

For a target run, previous context should be:

```text
latest eligible continuity entry for the same workspace + symbol whose source
run completed before the target run
```

If that previous context cannot be found:

```text
create a baseline-style repair entry
mark repair metadata with previous_context = none
```

If the only available previous context would be after the target run:

```text
do not use it
do not move state backward
report previous_context = unavailable_or_after_target
```

This rule matters because V1.3 is repairing a ledger. A repair for a May 10 run
must not accidentally compare May 10 research against the May 28 current state.

## Repair Execution Rules

Repair execution should reuse the existing deterministic continuity pipeline
where possible:

```text
load source run
load artifacts
build snapshot
compute events against historical previous context
render normal continuity report
add repair context
save snapshot if one exists
save append-only entry
conditionally update state
```

For skipped outputs:

```text
save an append-only skipped repair entry only when useful for audit
do not update state
report action not_improved or still_skipped when no useful repair is created
```

For degraded outputs:

```text
create a degraded repair entry only if the source entry was skipped or worse,
or if audit visibility is explicitly useful
do not update state unless existing state rules already allow degraded updates
```

V1.3 should avoid making broad changes to `generateForRun`. Add internal helper
methods if needed so normal generation and repair generation can share snapshot
loading/building/report rendering without mixing semantics.

## Append-Only And Idempotency

Repair/backfill must never overwrite old entries.

Use a deterministic repair identity:

```ts
{
  run_id: string;
  case_type: string;
  repair_version: 'research-continuity-v1.3';
  source_entry_id: string | null;
}
```

Store it in entry metadata:

```json
{
  "repair": {
    "is_repair": true,
    "repair_version": "research-continuity-v1.3",
    "case_type": "legacy_evidence",
    "identity_key": "research-continuity-v1.3:legacy_evidence:run_123:entry_456",
    "source_run_id": "run_123",
    "source_entry_id": "entry_456"
  }
}
```

Before writing:

```text
look up an existing repair entry with the same identity
if found, return already_repaired
if missing_continuity now has a normal continuity entry, return
already_has_continuity
if source entry changed after preview, re-evaluate candidate before writing
```

Do not rely only on client-side preview state. The run endpoint must re-check
eligibility and idempotency server-side.

If JSON metadata lookup is awkward in Postgres, add the smallest repository
query needed. Do not create a repair table in V1.3 unless there is no reliable
way to implement idempotency without it.

## State Projection Rules

`ContinuityState` is the latest projection for the next research run. It must
not move backward because an old run was repaired.

Update state only when:

```text
new repair entry status is completed
and target run is the latest eligible completed run for workspace + symbol
```

Also allow state update when:

```text
the repaired source entry is the current state's latest_entry_id
and the repair improves that same latest run
```

Do not update state when:

```text
target run completed before the current state's latest_run_id
new entry is skipped, failed, or still degraded
candidate is historical backfill only
previous context is unavailable and a newer state exists
```

For batch repair:

```text
process candidates in source run completion order
after the batch, ensure state points to the newest eligible completed repair or
existing entry by run completion time
not by repair entry generated_at time
```

Add tests for this. This is the easiest V1.3 bug to miss.

## Audit Metadata

Every repair entry should carry audit metadata in `payload.repair`:

```json
{
  "repair": {
    "is_repair": true,
    "repair_version": "research-continuity-v1.3",
    "case_type": "legacy_evidence",
    "reason": "tracked items missing evidence_quality",
    "identity_key": "research-continuity-v1.3:legacy_evidence:run_123:entry_456",
    "source_run_id": "run_123",
    "source_entry_id": "entry_456",
    "previous_context_entry_id": "entry_111",
    "created_from": "manual_repair",
    "requested_by": "api",
    "dry_run": false,
    "state_updated": false,
    "repaired_at": "2026-05-28T00:00:00.000Z"
  }
}
```

Missing continuity can use:

```json
{
  "source_entry_id": null
}
```

If `userId` is available and safe to store, include it as
`requested_by_user_id`. Do not leak secrets or auth tokens into payload JSON.

## Repair Report Context

Repair entries should keep the normal report structure:

```text
summary
sections
events
snapshot_quality
writer_metadata
```

Add a repair context section or header with:

```text
case type
source run id
previous entry id
previous context entry id
repair reason
repair version
state updated yes/no
```

Do not build a separate report schema just for repair. The UI should be able to
render repair entries in the same entry list as normal entries.

## UI MVP

Update only `/research-continuity`.

Add a compact "Repair & Backfill" panel. It is maintenance-only and hidden by
default unless `VITE_ENABLE_RESEARCH_CONTINUITY_REPAIR=true`.

Controls:

```text
symbol
from date
to date
case types
limit
Preview button
Run repair button after preview
dry-run/execution state
```

Candidate table:

```text
run id
symbol
completed at
case type
current entry status
reason
eligible
predicted action
```

Result summary:

```text
repaired
skipped
failed
created entry ids
state updated yes/no
```

Keep the UI modest:

```text
no progress streaming
no queue monitor
no graph
no timeline
no per-row diff viewer
no role-management UI
```

If UI implementation becomes too large, keep the API complete and add only the
minimum form/table needed for manual smoke.

## Constraints And Non-Goals

Explicitly do not:

- run repair automatically on app boot;
- run repair automatically when `/research-continuity` loads;
- run repair automatically after every research completion;
- add scheduled jobs, queues, or workers;
- silently rewrite, delete, or mutate old continuity entries;
- move `ContinuityState` backward for historical repairs;
- add graph/node/timeline tables or UI;
- add semantic retrieval, embeddings, or fuzzy LLM merge;
- add a continuity agent or research debate agent;
- change AI-service research output contracts unless fixing a confirmed bug;
- implement Calibration, PnL, hit rate, or market correctness;
- create bulk repair without `limit`;
- add a DB schema reset or local data deletion workflow.

## Implementation Checklist

- [x] Inspect current continuity service, repository, DTO, OpenAPI, and web
      service patterns.
- [x] Add repair DTO/request/response types.
- [x] Add repository methods for bounded candidate discovery and repair
      idempotency lookup.
- [x] Add preview service logic for the three candidate types.
- [x] Add historical previous-context selection for repair generation.
- [x] Add repair execution logic that re-checks candidates server-side.
- [x] Add append-only repair metadata and idempotency identity.
- [x] Add state projection guard so historical repair cannot move state
      backward.
- [x] Add repair context to report rendering.
- [x] Add controller endpoints and OpenAPI/generated client updates.
- [x] Add `/research-continuity` repair/backfill panel.
- [x] Add focused API tests and web typecheck coverage.
- [x] Run validation commands.

## Required Tests

API contract/service tests:

- [x] Preview returns `missing_continuity` for a completed run without an entry.
- [x] Preview returns `skipped_or_degraded` for a skipped/degraded latest entry
      when artifacts now build a better snapshot.
- [x] Preview returns `legacy_evidence` when entry payload or snapshot quality
      lacks V1.2 evidence metadata.
- [x] Preview does not write snapshots, entries, or state.
- [x] Dry-run `POST /repair/run` writes nothing.
- [x] Executed repair creates an append-only entry and preserves the old entry.
- [x] Re-running the same repair returns `already_repaired` and does not create
      duplicates.
- [x] Missing-continuity execution returns `already_has_continuity` if a normal
      entry appeared after preview.
- [x] Historical repair uses previous context before the target run, not current
      latest state.
- [x] Repairing an old run does not move `ContinuityState` backward.
- [x] Repairing the latest eligible completed run can update state.
- [x] Repair entry payload includes `payload.repair` audit metadata.
- [x] Repair report includes repair context.
- [x] Unauthorized or insufficient workspace access is rejected according to
      existing auth patterns.

Repository tests or fake repository coverage:

- [x] Candidate discovery is bounded by workspace.
- [x] Symbol filter works.
- [x] Date range filter works.
- [x] Limit is enforced.
- [x] Repair identity lookup finds prior repair entries.

Web checks:

- [x] `/research-continuity` compiles with repair DTO/service types.
- [x] Preview form calls the preview API and renders candidates.
- [x] Run action calls the run API and renders result summary.
- [x] UI handles empty candidate list.
- [x] UI handles partial failures without crashing.

No required tests:

- AI-service full suite, unless AI-service code changes.
- Playwright, unless normal app smoke cannot verify the UI.
- Graph/timeline behavior.
- Scheduled job behavior.
- Calibration or market correctness.

## Validation Loop

Automated checks:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

If implementation touches AI-service unexpectedly, also run:

```bash
.venv\Scripts\python.exe -m pytest apps/ai-service
```

Manual checks:

- Start API and web dev servers.
- Open `/research-continuity?symbol=BTC%2FUSDT`.
- Use the repair panel to preview with a small limit.
- Confirm preview returns candidates or an understandable empty state.
- Run dry-run and confirm no new entries appear.
- Execute one safe repair candidate in local data.
- Confirm a new repair entry appears in recent entries.
- Confirm the old entry still exists.
- Confirm repair metadata/report context is visible.
- Confirm state does not move backward after repairing an older run.

## Checkpoint Behavior

Work milestone by milestone:

1. Define DTO/API contract and candidate/result shapes.
2. Add repository support for bounded discovery and repair identity lookup.
3. Implement preview candidate discovery.
4. Implement repair execution, append-only writes, idempotency, and state guard.
5. Add repair report context.
6. Add controller/OpenAPI/generated client updates.
7. Add MVP `/research-continuity` repair panel.
8. Add tests and run validation.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- preserve unrelated dirty worktree changes;
- keep the work inside V1.3 scope;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- implementing candidate discovery requires unbounded full-history scans;
- implementing idempotency requires a DB schema change that cannot be kept
  small;
- historical previous context cannot be determined safely;
- state projection would move backward;
- implementing the next step requires graph/node/timeline work;
- implementing the next step requires an LLM or semantic retrieval;
- implementation requires changing AI-service research generation for reasons
  other than a confirmed compatibility bug;
- validation fails for external/environment reasons;
- V1.3 repair/backfill objective is already met.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/research-continuity/v1.3/implementation-plan.md first and
treat it as the source of truth for Research Continuity V1.3.

Implement only V1.3 Repair And Backfill Control. The goal is to add manual,
idempotent preview/run tooling for missing continuity, skipped/degraded repair,
and legacy evidence repair.

Do not add automatic repair, scheduled jobs, graph/timeline UI, semantic
retrieval, LLM agents, Calibration behavior, AI-service prompt/schema changes,
DB resets, data deletion workflows, or overwrite old continuity history.

Before editing, inspect the files listed in "Files to inspect first". Follow
existing NestJS, repository, OpenAPI/generated client, React Query, routing, and
CSS patterns. Preserve unrelated dirty worktree changes.

Pay special attention to state projection: repairing an old run must not move
ContinuityState backward. Ask only if the codebase contradicts this plan or
required context is missing.
```

## Definition Of Done

- Repair/backfill preview and run APIs exist and are workspace-scoped.
- V1.3 detects missing continuity, skipped/degraded repair, and legacy evidence
  repair candidates.
- Repair execution is explicit, bounded, append-only, and idempotent.
- Old entries remain preserved and repair entries carry audit metadata.
- Repair reports include repair context without changing the normal report
  shape.
- State projection does not move backward for historical repairs.
- `/research-continuity` has an MVP repair/backfill panel.
- Required tests and validation commands pass, or blockers are documented.
