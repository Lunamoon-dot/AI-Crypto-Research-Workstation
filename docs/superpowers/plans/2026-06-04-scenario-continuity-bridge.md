# Scenario Continuity Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scenario` a first-class input and output of the research continuity pipeline so continuity can track branch-level memory across runs, not just thesis-derived tracked items.

**Architecture:** Extend the continuity pipeline in-place. Keep `scenario_branches` as structured continuity memory on snapshots and continuity state, then project that memory into delta events, diff summaries, lifecycle views, and the existing continuity UI. Do not replace the current `tracked_items` model; keep it as the generic projection layer for claims, risks, watchpoints, levels, and invalidations.

**Tech Stack:** NestJS API, TypeScript DTOs, repository-backed JSON persistence, React frontend, TanStack Query, existing continuity presenter/rendering pipeline, Node test runner.

---

## Scope and assumptions

- Continuity remains the source of cross-run memory.
- Scenario data already exists and is retrievable through `JournalRepository.listScenarios(thesisId, workspaceId)`.
- We are not changing Python scenario generation in this phase.
- We are not adding a brand-new database table. We will persist new fields inside the existing continuity snapshot/state JSON payloads first.
- We will preserve existing `tracked_items` behavior and add scenario memory alongside it.

## File map

**API core**

- Modify: `apps/api/src/research-continuity/research-snapshot.builder.ts`
  - Add `scenarios` input.
  - Build `scenario_branches`.
  - Project scenario fields into `tracked_items` with scenario metadata.
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
  - Load scenarios in `loadArtifacts()`.
  - Return scenario fields in snapshot/state responses.
  - Include scenario digests in summary/detail response shaping where needed.
- Modify: `apps/api/src/research-continuity/continuity-delta.engine.ts`
  - Compare `scenario_branches`.
  - Emit scenario lifecycle events.
- Modify: `apps/api/src/research-continuity/continuity-state.projector.ts`
  - Maintain `active_scenarios`, `recent_resolved_scenarios`, `recent_invalidated_scenarios`.
- Modify: `apps/api/src/research-continuity/continuity-diff-report.presenter.ts`
  - Render scenario events into diff groups and changed items.
- Modify: `apps/api/src/research-continuity/continuity-report.renderer.ts`
  - Add scenario continuity lines to thin report.
- Modify: `apps/api/src/research-continuity/continuity-timeline.presenter.ts`
  - Make scenario lifecycle rows show up as first-class lifecycle items.
- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
  - Extend snapshot/state/detail response contracts.
- Modify: `apps/api/src/database/journal.types.ts`
  - Ensure `JournalRepository` consumers can rely on `listScenarios`.

**Tests**

- Modify: `apps/api/test/api-contract.test.ts`
  - Cover DTO shape, fake repository behavior, snapshot/state/detail responses, and continuity generation using scenarios.
- Modify: `apps/api/test/research-continuity-timeline.presenter.test.ts`
  - Add timeline coverage for scenario lifecycle rows.

**Frontend**

- Modify: `apps/web/src/services/research-continuity.ts`
  - Consume expanded API types if regeneration is needed.
- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
  - Show scenario continuity summary in current view/lifecycle area.
- Modify: `apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx`
  - Show scenario continuity changes inside detail entry.
- Modify: `apps/web/src/pages/research-continuity-current-view.ts`
  - Add current active scenario branch summary.
- Modify: `apps/web/src/pages/research-continuity-lifecycle.ts`
  - Support scenario item labels/status display.
- Modify: `apps/web/test/research-continuity-current-view.test.ts`
  - Verify current-view rendering with active scenarios.
- Modify: `apps/web/test/research-continuity-lifecycle.test.ts`
  - Verify lifecycle mapping for scenario events.

**Documentation**

- Modify: `docs/project-status.md` or `docs/features/...` only if this repo already tracks continuity feature notes there.
  - Keep this optional and last.

---

### Task 1: Lock the continuity contract for scenario memory

**Files:**
- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing API contract assertions for scenario continuity fields**

Add assertions to the continuity schema checks and example response checks for:

```ts
assert.ok('scenario_branches' in snapshotProperties);
assert.ok('active_scenarios' in continuityStateProperties);
assert.ok('recent_resolved_scenarios' in continuityStateProperties);
assert.ok('recent_invalidated_scenarios' in continuityStateProperties);
```

Also add a concrete response-level assertion in an existing continuity test:

```ts
assert.equal(records(snapshotRecord.scenario_branches).length, 1);
assert.equal(records(stateRecord.active_scenarios).length, 1);
assert.equal(record(records(stateRecord.active_scenarios)[0]).scenario_id, 'scenario_1');
```

- [ ] **Step 2: Run the API contract test to verify it fails**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: FAIL because the current DTO/response shape does not expose scenario continuity fields.

- [ ] **Step 3: Extend continuity DTO types**

Add explicit scenario-bearing fields to the DTO interfaces that already expose raw JSON:

```ts
export interface ResearchSnapshotResponse {
  // existing fields...
  scenario_branches: JsonRecord[];
}

export interface ResearchContinuityStateResponse {
  // existing fields...
  active_scenarios: JsonRecord[];
  recent_resolved_scenarios: JsonRecord[];
  recent_invalidated_scenarios: JsonRecord[];
}
```

If entry detail payloads need direct access to scenario counts or digests, add them in the same file rather than inventing a new DTO file.

- [ ] **Step 4: Run the contract test again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: Still FAIL, now deeper in response shaping because service mappings do not populate the new fields yet.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/research-continuity/dto/research-continuity.dto.ts apps/api/test/api-contract.test.ts
git commit -m "test: lock scenario continuity API contract"
```

### Task 2: Extend snapshot building to ingest and normalize scenarios

**Files:**
- Modify: `apps/api/src/research-continuity/research-snapshot.builder.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add a failing snapshot-generation test for `scenario_branches`**

In the continuity generation test harness, seed:

```ts
journal.scenarios.set(key('thesis_1', 'workspace_a'), [
  {
    id: 'scenario_1',
    thesis_id: 'thesis_1',
    condition: 'If BTC reclaims 108k on acceptance',
    expected_behavior: 'Momentum continuation toward prior highs',
    probability_band: 'medium',
    invalidation: 'Loses 104k after reclaim',
    risk_map: ['crowded funding'],
    suggested_user_action: 'watch confirmation',
    payload: { branch_type: 'confirmation' },
  },
]);
```

Then assert:

```ts
assert.equal(records(snapshotRecord.scenario_branches).length, 1);
assert.equal(record(records(snapshotRecord.scenario_branches)[0]).branch_type, 'confirmation');
assert.equal(
  records(snapshotRecord.tracked_items).some(
    (item) => record(item.attributes).scenario_key === 'thesis_1:confirmation:if-btc-reclaims-108k-on-acceptance',
  ),
  true,
);
```

- [ ] **Step 2: Run the failing continuity test**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: FAIL because `ResearchSnapshotBuildInput` and snapshot payload do not know about scenarios.

- [ ] **Step 3: Extend snapshot input, source artifacts, and payload**

Update `ResearchSnapshotBuildInput`:

```ts
export interface ResearchSnapshotBuildInput {
  run: JsonRecord;
  debate: JsonRecord | null;
  agentOpinions: JsonRecord[];
  thesis: JsonRecord | null;
  scenarios: JsonRecord[];
  marketSnapshot: JsonRecord | null;
  signalSnapshot: JsonRecord | null;
}
```

Add a `buildScenarioBranches()` helper that returns objects like:

```ts
{
  scenario_key: stableScenarioKey(scenario),
  thesis_id: nullableString(scenario.thesis_id),
  scenario_id: nullableString(scenario.id),
  branch_type: scenarioBranchType(scenario),
  condition: stringValue(scenario.condition),
  expected_behavior: stringValue(scenario.expected_behavior),
  probability_band: normalizeProbabilityBand(scenario.probability_band),
  invalidation: stringValue(scenario.invalidation),
  risk_factors: stringList(scenario.risk_map ?? recordValue(scenario.payload).risk_factors),
  suggested_action: stringValue(scenario.suggested_user_action),
  source_artifact: 'scenario',
  source_id: nullableString(scenario.id),
}
```

Update snapshot shape:

```ts
const snapshot = {
  // existing fields...
  scenario_branches: scenarioBranches,
  source_artifacts: {
    // existing fields...
    scenario_ids: scenarioBranches.map((branch) => branch.scenario_id).filter(Boolean),
  },
  payload: {
    schema_version: 'research_snapshot.v1.2',
    // existing fields...
  },
};
```

Project each branch into tracked items with `attributes.scenario_key`, `attributes.branch_type`, and `attributes.thesis_id`.

- [ ] **Step 4: Implement stable scenario identity helpers**

Inside `research-snapshot.builder.ts`, add local helpers:

```ts
function stableScenarioKey(scenario: JsonRecord): string { /* thesis_id + branch_type + normalized condition */ }
function normalizeProbabilityBand(value: unknown): 'low' | 'medium' | 'high' | 'watch' | 'unknown' { /* normalize */ }
function scenarioBranchType(scenario: JsonRecord): string { /* payload.branch_type fallback to 'branch' */ }
```

Do this in the same file unless the file becomes unreadable. Do not create a new shared utility unless reused by 2+ modules in this phase.

- [ ] **Step 5: Run the continuity contract test again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: Snapshot assertions pass; downstream state/delta assertions still fail.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/research-continuity/research-snapshot.builder.ts apps/api/test/api-contract.test.ts
git commit -m "feat: add scenario branches to research snapshots"
```

### Task 3: Load scenarios in continuity generation and expose them in responses

**Files:**
- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add a failing service-level assertion that continuity generation loads scenarios**

Reuse the fake journal repository and assert after generation:

```ts
assert.equal(records(snapshotRecord.source_artifacts).scenario_ids.length, 1);
assert.equal(records(snapshotRecord.scenario_branches).length, 1);
```

If the fake repository already stores scenarios, do not add a new fake abstraction.

- [ ] **Step 2: Run the continuity generation test**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: FAIL because `loadArtifacts()` does not return scenarios.

- [ ] **Step 3: Extend `loadArtifacts()`**

Update the method contract:

```ts
private async loadArtifacts(...): Promise<{
  debate: JsonRecord | null;
  agentOpinions: JsonRecord[];
  thesis: JsonRecord | null;
  scenarios: JsonRecord[];
  marketSnapshot: JsonRecord | null;
  signalSnapshot: JsonRecord | null;
}>
```

Load scenarios after resolving `thesisId`:

```ts
const scenarios = thesisId
  ? await this.journal.listScenarios(thesisId, workspaceId)
  : [];
```

Pass `scenarios` into `this.snapshotBuilder.build(...)`.

- [ ] **Step 4: Expose `scenario_branches` and scenario state fields in response mappers**

Update:

```ts
export function toSnapshotResponse(snapshot: JsonRecord): ResearchSnapshotResponse
function toStateResponse(state: JsonRecord): ResearchContinuityStateResponse
```

to include:

```ts
scenario_branches: arrayRecords(snapshot.scenario_branches),
active_scenarios: arrayRecords(state.active_scenarios),
recent_resolved_scenarios: arrayRecords(state.recent_resolved_scenarios),
recent_invalidated_scenarios: arrayRecords(state.recent_invalidated_scenarios),
```

- [ ] **Step 5: Run the continuity generation test again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: Snapshot response passes; delta/state tests still fail because scenario continuity is not yet compared/projected.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/research-continuity/research-continuity.service.ts apps/api/src/database/journal.types.ts apps/api/test/api-contract.test.ts
git commit -m "feat: load scenario artifacts into continuity generation"
```

### Task 4: Add scenario-aware delta computation and continuity state projection

**Files:**
- Modify: `apps/api/src/research-continuity/continuity-delta.engine.ts`
- Modify: `apps/api/src/research-continuity/continuity-state.projector.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing delta/state assertions for scenario lifecycle**

Seed a previous continuity state with one active scenario:

```ts
active_scenarios: [
  {
    scenario_key: 'thesis_1:confirmation:if-btc-reclaims-108k-on-acceptance',
    scenario_id: 'scenario_1',
    probability_band: 'low',
    invalidation: 'Loses 104k after reclaim',
  },
],
```

Generate a new run with the same scenario but `probability_band: 'high'`.

Assert:

```ts
assert.equal(
  records(diffReport.changed_items).some(
    (item) => record(item).event_type === 'scenario_probability_changed',
  ),
  true,
);
assert.equal(records(stateRecord.active_scenarios).length, 1);
assert.equal(record(records(stateRecord.active_scenarios)[0]).probability_band, 'high');
```

- [ ] **Step 2: Run the failing continuity test**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: FAIL because the delta engine ignores `scenario_branches`.

- [ ] **Step 3: Extend delta engine with scenario compare**

Inside `compute()` compare:

```ts
const previousScenarios = arrayRecords(previousState.active_scenarios);
const currentScenarios = arrayRecords(snapshot.scenario_branches);
```

Emit only the first minimal event set in this phase:

```ts
'scenario_added'
'scenario_carried'
'scenario_probability_changed'
'scenario_invalidated'
```

Event payload shape:

```ts
{
  event_type: 'scenario_probability_changed',
  severity: 'medium',
  from: previousScenario,
  to: currentScenario,
  item_key: stringValue(currentScenario.scenario_key),
  reason: 'Scenario probability changed from low to high.',
  source: { source_artifact: 'scenario', source_id: currentScenario.scenario_id, source_field: 'probability_band' },
}
```

Keep this logic separate from generic tracked-item compare, but reuse local helpers where sensible.

- [ ] **Step 4: Extend state projector**

Maintain:

```ts
active_scenarios
recent_resolved_scenarios
recent_invalidated_scenarios
```

Mirror the existing item lifecycle pattern:

```ts
const activeScenarios = canUpdateItems
  ? lifecycleScenarios(previousState, snapshot, entry, events)
  : arrayRecords(previousState?.active_scenarios);
```

Do not overload `active_items` with scenario objects.

- [ ] **Step 5: Run the continuity generation test again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts
```

Expected: Scenario delta/state assertions pass; report/timeline/UI assertions may still fail because presenters do not surface the new events.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/research-continuity/continuity-delta.engine.ts apps/api/src/research-continuity/continuity-state.projector.ts apps/api/test/api-contract.test.ts
git commit -m "feat: track scenario lifecycle in continuity state"
```

### Task 5: Surface scenario continuity in reports, diff summaries, and timeline

**Files:**
- Modify: `apps/api/src/research-continuity/continuity-diff-report.presenter.ts`
- Modify: `apps/api/src/research-continuity/continuity-report.renderer.ts`
- Modify: `apps/api/src/research-continuity/continuity-timeline.presenter.ts`
- Modify: `apps/api/test/research-continuity-timeline.presenter.test.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing presenter assertions**

In `api-contract.test.ts`, assert a scenario probability change appears in detail diff output:

```ts
assert.equal(
  records(record(detailRecord.diff_report).changed_items).some(
    (item) => record(item).event_type === 'scenario_probability_changed' &&
      record(item).item_type === 'scenario',
  ),
  true,
);
```

In `research-continuity-timeline.presenter.test.ts`, assert a scenario event becomes a lifecycle item:

```ts
assert.equal(
  response.lifecycle_items.some((item) => item.item_type === 'scenario'),
  true,
);
```

- [ ] **Step 2: Run the failing presenter tests**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/research-continuity-timeline.presenter.test.ts apps/api/test/api-contract.test.ts
```

Expected: FAIL because scenario events are currently unknown to presenters.

- [ ] **Step 3: Extend diff presenter classifications**

Map scenario events to changed item rows:

```ts
scenario_added -> group 'added'
scenario_probability_changed -> group 'updated'
scenario_invalidated -> group 'removed_resolved'
scenario_carried -> omit from material diff rows unless the repo already shows carried rows
```

Add item type support:

```ts
type ResearchContinuityDiffItemType = 'claim' | 'risk' | 'watchpoint' | 'level' | 'invalidation' | 'scenario' | 'view' | 'quality' | 'unknown';
```

- [ ] **Step 4: Extend thin report and timeline presenter**

In the report renderer, add a scenario continuity section or append scenario lines to `material_changes`, for example:

```ts
'Scenario probability increased: confirmation reclaim branch now high probability.'
'Scenario invalidated: breakdown branch removed from active continuity.'
```

In the timeline presenter, classify scenario events as:

```ts
item_type: 'scenario'
stable_item_key: stringValue(event.item_key)
source_artifacts: ['scenario']
```

Keep the existing timeline windowing behavior unchanged.

- [ ] **Step 5: Run the presenter tests again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/research-continuity-timeline.presenter.test.ts apps/api/test/api-contract.test.ts
```

Expected: PASS for API presenter coverage.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/research-continuity/continuity-diff-report.presenter.ts apps/api/src/research-continuity/continuity-report.renderer.ts apps/api/src/research-continuity/continuity-timeline.presenter.ts apps/api/test/research-continuity-timeline.presenter.test.ts apps/api/test/api-contract.test.ts
git commit -m "feat: render scenario continuity in reports and timeline"
```

### Task 6: Add scenario continuity to the web UI

**Files:**
- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
- Modify: `apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx`
- Modify: `apps/web/src/pages/research-continuity-current-view.ts`
- Modify: `apps/web/src/pages/research-continuity-lifecycle.ts`
- Modify: `apps/web/test/research-continuity-current-view.test.ts`
- Modify: `apps/web/test/research-continuity-lifecycle.test.ts`

- [ ] **Step 1: Add failing UI tests for active scenarios and scenario lifecycle labeling**

In `research-continuity-current-view.test.ts`, add a state fixture:

```ts
active_scenarios: [
  {
    scenario_key: 'thesis_1:confirmation:if-btc-reclaims-108k-on-acceptance',
    branch_type: 'confirmation',
    probability_band: 'high',
    condition: 'If BTC reclaims 108k on acceptance',
  },
],
```

Assert that the rendered output includes the scenario condition and probability.

In `research-continuity-lifecycle.test.ts`, add a lifecycle item:

```ts
{
  item_type: 'scenario',
  status: 'updated',
  title: 'Scenario probability increased',
}
```

Assert that the label logic treats `scenario` as a first-class lifecycle type.

- [ ] **Step 2: Run the failing web tests**

Run:

```powershell
corepack pnpm test -- --runInBand apps/web/test/research-continuity-current-view.test.ts apps/web/test/research-continuity-lifecycle.test.ts
```

Expected: FAIL because the current UI ignores scenario continuity state.

- [ ] **Step 3: Update current-view and detail rendering**

Add a small scenario summary surface in the current-view panel, not a separate page. Example rendering target:

```tsx
<section aria-label="Scenario continuity">
  {state.active_scenarios.slice(0, 3).map((scenario) => (
    <div key={scenario.scenario_key}>
      <span className="badge">{scenario.probability_band}</span>
      <span>{scenario.condition}</span>
    </div>
  ))}
</section>
```

In entry detail, scenario changes should already flow through `diff_report`; only add extra direct rendering if the current screen otherwise hides them.

- [ ] **Step 4: Update lifecycle label helpers**

In `research-continuity-lifecycle.ts`, add:

```ts
if (value === 'scenario') return 'Scenario';
```

Keep the rest of the lifecycle filtering model unchanged.

- [ ] **Step 5: Run the web tests again**

Run:

```powershell
corepack pnpm test -- --runInBand apps/web/test/research-continuity-current-view.test.ts apps/web/test/research-continuity-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ResearchContinuityPage.tsx apps/web/src/pages/ResearchContinuityEntryDetailPage.tsx apps/web/src/pages/research-continuity-current-view.ts apps/web/src/pages/research-continuity-lifecycle.ts apps/web/test/research-continuity-current-view.test.ts apps/web/test/research-continuity-lifecycle.test.ts
git commit -m "feat: show scenario continuity in research continuity UI"
```

### Task 7: Full verification and cleanup

**Files:**
- Modify only if required by breakage discovered during verification.

- [ ] **Step 1: Run focused API continuity tests**

Run:

```powershell
corepack pnpm test -- --runInBand apps/api/test/api-contract.test.ts apps/api/test/research-continuity-timeline.presenter.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web continuity tests**

Run:

```powershell
corepack pnpm test -- --runInBand apps/web/test/research-continuity-current-view.test.ts apps/web/test/research-continuity-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck or build for the touched app surfaces**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual verification checklist**

Verify in the app:

```text
1. Generate continuity for a run with thesis + scenarios.
2. Open the continuity entry detail page.
3. Confirm scenario change rows appear in Material Changes.
4. Open Research Continuity page for the symbol.
5. Confirm active scenario branches appear in current view.
6. Confirm lifecycle filters can show scenario items.
```

- [ ] **Step 5: Final cleanup**

Remove only imports and local helpers made unused by this feature. Do not refactor unrelated continuity code.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web
git commit -m "feat: bridge thesis scenarios into research continuity"
```

---

## Implementation notes and guardrails

- Keep scenario compare logic deterministic. No fuzzy matching beyond the stable scenario key.
- Normalize probability bands before persistence and before compare.
- Do not treat every scenario text drift as material. In this phase, only `added`, `invalidated`, and `probability changed` are required.
- Keep `tracked_items` backward compatible so existing continuity consumers continue to work.
- Prefer enriching existing report/timeline flows over adding parallel scenario-only endpoints.

## Success criteria

- A continuity snapshot stores `scenario_branches`.
- Continuity state stores `active_scenarios` and recent scenario lifecycle arrays.
- A later run can detect scenario branch add, carry, probability shift, and invalidation.
- Diff report and timeline expose scenario continuity without breaking current thesis/item continuity.
- The research continuity UI shows which scenario branches are currently active.

## Out of scope for this plan

- Rewriting scenario generation prompts or Python scenario planner output.
- Adding a standalone scenario history subsystem separate from continuity.
- Complex scenario branch merge/replacement heuristics.
- Full scenario resolution semantics beyond invalidation in V1.

## Self-review

**Spec coverage:** Covered data loading, snapshot model, delta/state, report/timeline, API contract, and UI exposure. No identified gaps for the requested thesis-continuity-scenario bridge.

**Placeholder scan:** No `TODO`, `TBD`, or “add tests later” placeholders remain.

**Type consistency:** Plan uses `scenario_branches`, `active_scenarios`, `recent_resolved_scenarios`, and `recent_invalidated_scenarios` consistently across builder, service, state, DTO, and UI.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-scenario-continuity-bridge.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
