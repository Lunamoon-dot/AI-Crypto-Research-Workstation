# Research Continuity V1.4 Thin Report Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact default Research Continuity read model that keeps the full audit ledger intact while giving the UI a short, low-noise continuity report.

**Architecture:** V1.4 is additive. Continuity entries still store the full `sections`, `events`, snapshot quality, and audit metadata; the new thin report is rendered by the API backend and stored under entry JSON payload metadata as `report_views.thin`, then exposed as `thin_report` in API responses. Old entries without a stored thin report get a runtime-only fallback built from legacy `sections` plus `snapshot_quality`.

**Tech Stack:** NestJS API, TypeScript DTOs/contracts, deterministic continuity renderer, append-only Postgres JSON payloads, generated web API client, React continuity page.

---

Last updated: 2026-05-29
Status: implemented

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1.4 end-to-end.

Read this document first:
docs/features/research-continuity/v1.4/implementation-plan.md

Objective:
- Add a backend-generated thin continuity report for default UI/API reads.
- Preserve full continuity entries, events, payloads, evidence trace, and audit
  ledger behavior.
- Store new thin report metadata additively under
  payload.report_views.thin.
- Expose the thin report as thin_report in API responses.
- Add runtime fallback for older entries that do not have a stored thin report.
- Update the continuity UI to render thin_report first and keep debug/full trace
  behind an explicit debug affordance.

Do not implement:
- DB schema migrations or new columns.
- Deleting, trimming, or rewriting existing continuity entries.
- Removing legacy sections/events/payload from the API response in V1.4.
- Background backfill, scheduled repair, or read-path write-back.
- New LLM prompts, AI-service schema changes, semantic embeddings, graph model,
  or timeline/provenance explorer.
- Calibration, thesis outcome scoring, PnL, or market correctness evaluation.

Definition of done:
- New entries include payload.report_views.thin with version
  research_continuity_thin.v1.
- API responses expose thin_report for new entries and old entries.
- Thin report defaults to quality/current-view first, not stance-first.
- Degraded snapshots show data-quality warnings before bullish/bearish stance.
- Raw events and full debug trace are not part of thin_report.
- UI renders thin_report as the default continuity view.
- Existing full sections/events/payload remain available for compatibility.
- Focused API and web tests cover degraded snapshots, runtime fallback, noise
  filtering, and UI rendering.
- Required validation commands pass, or exact blockers are documented.
```

## One Outcome

Make Research Continuity readable by default.

After V1.4, a normal user should see a compact report that answers:

```text
How reliable is this continuity entry?
What is the current view?
What materially changed?
What risks and watchpoints matter now?
Where can I open the full debug/audit trace if I am allowed to?
```

The default view must not read like an event ledger, source trace, or agent
debate transcript.

## Verifiable End State

- [x] `payload.report_views.thin` exists on newly generated continuity entries.
- [x] `thin_report.version` is `research_continuity_thin.v1`.
- [x] `thin_report.quality` exposes structured quality fields for UI badges.
- [x] `thin_report.sections` is an ordered array with stable section ids.
- [x] `quality` and `current_view` sections are always present.
- [x] Optional sections are omitted when empty after sanitize/dedupe.
- [x] `thin_report` does not include raw `events`, `source_id`,
      `canonical_text`, full evidence arrays, or debug trace objects.
- [x] Degraded entries lead with data-quality warnings and evidence health.
- [x] Clean entries may show stance normally; degraded entries show stance only
      as draft/low-confidence or omit it when unsupported.
- [x] Existing API response fields remain backward-compatible in V1.4.
- [x] Old entries without stored thin reports get runtime fallback without DB
      mutation.
- [x] `/research-continuity` renders `thin_report` by default.
- [x] Debug/full JSON remains hidden by default and gated by explicit UI action.
- [x] API tests and web typecheck/build pass. The web package currently has no
      focused UI test runner; `pnpm --filter @lunaperception/web test`
      documents that gap.

## Completion Notes

Implemented on 2026-05-29.

Validation:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
pnpm --filter @lunaperception/web test
```

Results:

- API test suite passed: 130 tests.
- Web typecheck passed.
- Web build passed; Vite reported the pre-existing large chunk warning.
- Web test command reports that the web package has no tests yet.
- Browser smoke loaded `/research-continuity?symbol=BTC/USDT` on the existing
  local web server and rendered the Research Continuity page.

## Version Placement

```text
V1     Baseline post-research continuity loop.
V1.0.1 Auto-run patch for JobsService and BullMQ worker paths.
V1.1   Snapshot quality, evidence trace, identity stability, MVP workspace.
V1.2   Research Evidence Contract.
V1.3   Repair and Backfill Control Layer.
V1.4   Thin Report Read Model.
V1.5+  Optional debug response trimming, include_debug enforcement, scheduled
       repair, richer operations, or dedicated report view columns.
V2.x   Timeline, graph/node model, provenance explorer, and multi-symbol views.
```

V1.4 is a read-model and presentation contract. It must not change the ledger
source of truth.

## Decisions Already Made

- Backend-first.
- Additive rollout; do not remove legacy `sections`, `events`, or `payload` in
  V1.4.
- Store the durable thin report under `payload.report_views.thin`.
- Expose `thin_report` as a convenient API response field.
- Generate the thin report in `continuity-report.renderer.ts`, alongside the
  full report context.
- Runtime fallback for old entries is allowed, but read paths must not write
  fallback views back to DB.
- `thin_report` contains compact sections, not raw events.
- Degraded reports lead with data-quality/confidence warning.
- Stance is headline-safe only for clean enough snapshots; degraded stance is
  draft/low-confidence or omitted.
- Evidence health is one concise line, not full provenance.
- Material changes use a whitelist and noise filter instead of all event lines.
- Resolved/weakened items are optional, capped at 3, and must be meaningful.
- Debug/full trace is a debug surface, not the default reader surface.
- `include_debug=true` is the future flag name, but V1.4 keeps legacy fields for
  compatibility.
- Caps are deterministic by item count, not token budget.
- Dedupe uses `canonical_text` first, normalized text second.
- Thin text is sanitized/plain text; source markdown is stripped.
- Heading-only lines are dropped.
- Production filtering is rule-based; regression tests use real bad phrases.
- Thin report has its own version: `research_continuity_thin.v1`.
- `thin_report.sections` is an ordered array with stable `id`.
- Only `quality` and `current_view` are required sections.

## Thin Report Contract

Shape:

```ts
type ResearchContinuityThinReport = {
  version: 'research_continuity_thin.v1';
  generated_at: string | null;
  debug_available: boolean;
  debug_requires_role: 'editor';
  quality: {
    status: string;
    score: number | null;
    observed_evidence_coverage: number | null;
    evidence_coverage: number | null;
    provenance_status: string | null;
    warnings: string[];
  };
  sections: ResearchContinuityThinSection[];
};

type ResearchContinuityThinSection = {
  id:
    | 'quality'
    | 'current_view'
    | 'material_changes'
    | 'active_risks'
    | 'watchpoints'
    | 'resolved_or_weakened'
    | 'evidence_health';
  title: string;
  items: string[];
};
```

Caps:

```text
quality              max 2 items
current_view         max 4 items
material_changes     max 5 items
active_risks         max 5 items
watchpoints          max 5 items
resolved_or_weakened max 3 items
evidence_health      max 1 item
```

Required sections:

```text
quality
current_view
```

Conditional sections:

```text
material_changes
active_risks
watchpoints
resolved_or_weakened
evidence_health
```

Quality-first degraded example:

```json
{
  "version": "research_continuity_thin.v1",
  "debug_available": true,
  "debug_requires_role": "editor",
  "quality": {
    "status": "degraded",
    "score": 1,
    "observed_evidence_coverage": 0.07,
    "evidence_coverage": 1,
    "provenance_status": "partial",
    "warnings": [
      "Snapshot degraded: observed evidence coverage 7%.",
      "Missing liquidations, funding, on-chain flows, and reliable news feed."
    ]
  },
  "sections": [
    {
      "id": "quality",
      "title": "Data Quality",
      "items": [
        "Snapshot degraded: observed evidence coverage 7%.",
        "Missing liquidations, funding, on-chain flows, and reliable news feed."
      ]
    },
    {
      "id": "current_view",
      "title": "Current View",
      "items": [
        "Directional bias: bullish.",
        "Risk posture: defensive.",
        "Conviction: low.",
        "Time context: daily_context."
      ]
    },
    {
      "id": "evidence_health",
      "title": "Evidence Health",
      "items": [
        "Evidence: 6 observed, 99 reasoning-only, 1 missing. Observed coverage 7%."
      ]
    }
  ]
}
```

## Filtering Rules

Sanitize text before display:

- Strip markdown markers such as `**`, `###`, blockquote prefixes, and `<br>`.
- Remove warning emoji and decorative symbols.
- Normalize whitespace.
- Trim dangling quotes and obvious JSON fragments.
- Keep numeric levels and symbol names.

Drop text when:

- It is heading-only, such as `Risks`, `Key Risk Factors`, `Summary`,
  `Synthesis`, `Liquidations`, or `On the risk/reward`.
- It starts as rhetorical debate prose, such as `you`, `your`, `i`, `we`,
  `let me`, `now`, `that's`, or `but`, and lacks concrete evidence.
- It is only a formatting change, such as `Liquidations: Neutral` to
  `Liquidations: **Neutral**`.
- It has no risk/action/level/metric/symbol/invalidation content after
  sanitization.

Keep agent-opinion risk text only when:

- It has explicit supporting evidence; or
- It has a direct risk phrase such as `downside risk`, `downside pressure`,
  `risk of further downside`, `further downside`, `liquidations`,
  `breakdown`, `lost support`, `invalidation`, `missing`, `unavailable`, or
  `stale`; or
- It has a contextual term such as `risk`, `funding`, `support`, `resistance`,
  `open interest`, `OI`, `macro`, or `liquidity` plus an adverse term such as
  `could`, `may`, `might`, `would`, `can`, `if`, `unless`, `failure`,
  `pressure`, `stress`, or `weakness`.

Regression phrases that must not appear in thin report:

```text
You call that weakness.
But that's precisely the risk-reward sweet spot.
That's acceleration to the downside.
```

## Relevant Context

Supporting docs:

- [docs/features/research-continuity/README.md](../README.md)
- [docs/features/research-continuity/v1/implementation-plan.md](../v1/implementation-plan.md)
- [docs/features/research-continuity/v1.1/implementation-plan.md](../v1.1/implementation-plan.md)
- [docs/features/research-continuity/v1.2/implementation-plan.md](../v1.2/implementation-plan.md)
- [docs/features/research-continuity/v1.3/implementation-plan.md](../v1.3/implementation-plan.md)

Files to inspect first:

```text
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-delta.engine.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
apps/web/src/types/index.ts
```

## Implementation Tasks

### Task 1: API Thin Report Types And Contract

**Files:**

- Modify: `apps/api/src/research-continuity/dto/research-continuity.dto.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing API response contract assertions**

Add a test that generates a continuity entry and asserts `entry.thin_report`
exists with:

```ts
assert.equal(delta.entry.thin_report?.version, 'research_continuity_thin.v1');
assert.equal(delta.entry.thin_report?.debug_available, true);
assert.equal(delta.entry.thin_report?.debug_requires_role, 'editor');
assert.ok(
  delta.entry.thin_report?.sections.some(
    (section) => section.id === 'quality',
  ),
);
assert.ok(
  delta.entry.thin_report?.sections.some(
    (section) => section.id === 'current_view',
  ),
);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because `thin_report` is not exposed yet.

- [ ] **Step 3: Add DTO/interface fields**

Add TypeScript response shapes for `ResearchContinuityThinReport` and
`ResearchContinuityThinSection`. Extend the continuity entry response to include:

```ts
thin_report?: ResearchContinuityThinReport | null;
```

- [ ] **Step 4: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: compile succeeds, the contract test still fails until renderer/service
implementation exists.

### Task 2: Deterministic Thin Renderer

**Files:**

- Modify: `apps/api/src/research-continuity/continuity-report.renderer.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add degraded thin-report test**

Seed or mutate a continuity run so the snapshot quality is degraded with:

```ts
observed_evidence_coverage: 0.07,
observed_evidence_count: 6,
reasoning_evidence_count: 99,
missing_evidence_count: 1,
reasons: [
  'missing_liquidations',
  'missing_funding_rate',
  'missing_onchain_flows',
  'missing_the_news_tool_returned_a_missing_news_feed_status',
],
```

Assert:

```ts
const thin = delta.entry.thin_report;
assert.equal(thin?.quality.status, 'degraded');
assert.equal(thin?.sections[0]?.id, 'quality');
assert.ok(
  thin?.sections[0]?.items.some((item) =>
    item.toLowerCase().includes('snapshot degraded'),
  ),
);
assert.equal(
  JSON.stringify(thin).includes('source_id'),
  false,
);
assert.equal(
  JSON.stringify(thin).includes('canonical_text'),
  false,
);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because renderer has no thin output.

- [ ] **Step 3: Implement thin renderer output**

Extend the deterministic renderer return value with `thinReport`. Build it from:

```text
snapshot.data_quality
snapshot.symbol_view
events
repair/skipped context when present
```

Do not include raw event objects in thin report.

- [ ] **Step 4: Add sanitizer and section caps**

Add local helper functions in the renderer unless they become too large:

```ts
sanitizeThinText(value: string): string
isHeadingOnlyThinText(value: string): boolean
selectThinItems(items: string[], cap: number): string[]
dedupeThinItems(items: CandidateThinItem[]): string[]
```

The helpers must implement the filtering and caps from this plan.

- [ ] **Step 5: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: thin renderer tests pass.

### Task 3: Store Thin Report In Entry Payload

**Files:**

- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add storage assertion**

Assert newly saved entries include:

```ts
assert.equal(
  delta.entry.payload.report_views?.thin?.version,
  'research_continuity_thin.v1',
);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because service does not persist the view yet.

- [ ] **Step 3: Store report view metadata**

Where service currently saves `payload`, add:

```ts
report_views: {
  thin: report.thinReport,
},
```

Apply this consistently for normal, skipped, and repair-created continuity
entries.

- [ ] **Step 4: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: storage assertion passes.

### Task 4: Expose Thin Report With Runtime Fallback

**Files:**

- Modify: `apps/api/src/research-continuity/research-continuity.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add fallback test for old entries**

Create a Postgres-shaped or fake old entry with `sections` and
`snapshot_quality`, but without `payload.report_views.thin`.

Assert:

```ts
const response = await researchContinuity.getEntry(
  'continuity_old_without_thin',
  'user_1',
  'workspace_a',
);
assert.equal(response.thin_report?.version, 'research_continuity_thin.v1');
assert.ok(
  response.thin_report?.sections.some((section) => section.id === 'quality'),
);
assert.equal(
  response.payload.report_views?.thin,
  undefined,
);
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: FAIL because fallback does not exist.

- [ ] **Step 3: Implement response mapping**

Update `toEntryResponse()` so:

```text
thin_report = payload.report_views.thin if present
thin_report = build fallback from sections + snapshot_quality otherwise
```

The fallback must not mutate `payload`.

- [ ] **Step 4: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: new and legacy entries expose `thin_report`.

### Task 5: Thin Report Noise Regression

**Files:**

- Modify: `apps/api/src/research-continuity/research-snapshot.builder.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Preserve current rhetorical-risk regression**

Keep test coverage proving these lines do not become tracked risks or thin
report items:

```text
You call that weakness.
But that's precisely the risk-reward sweet spot.
That's acceleration to the downside.
```

- [ ] **Step 2: Add thin-report assertion**

After continuity generation, assert:

```ts
const serializedThin = JSON.stringify(delta.entry.thin_report);
assert.equal(serializedThin.includes('You call that weakness'), false);
assert.equal(
  serializedThin.includes("But that's precisely the risk-reward sweet spot"),
  false,
);
assert.equal(
  serializedThin.includes("That's acceleration to the downside."),
  false,
);
```

- [ ] **Step 3: Run API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: all continuity noise tests pass.

### Task 6: Web Default Thin Rendering

**Files:**

- Modify: `apps/web/src/pages/ResearchContinuityPage.tsx`
- Modify: `apps/web/src/services/research-continuity.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Add web type definitions**

Add frontend types matching the API thin report shape:

```ts
export interface ResearchContinuityThinReport {
  version: 'research_continuity_thin.v1';
  generated_at: string | null;
  debug_available: boolean;
  debug_requires_role: 'editor';
  quality: {
    status: string;
    score: number | null;
    observed_evidence_coverage: number | null;
    evidence_coverage: number | null;
    provenance_status: string | null;
    warnings: string[];
  };
  sections: Array<{
    id: string;
    title: string;
    items: string[];
  }>;
}
```

- [ ] **Step 2: Render thin report first**

Update the continuity page so the default report cards/sections read from:

```ts
entry.thin_report?.sections ?? entry.sections
```

Keep full/debug JSON collapsed by default.

- [ ] **Step 3: Run web typecheck**

Run:

```powershell
pnpm --filter @lunaperception/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Run web build**

Run:

```powershell
pnpm --filter @lunaperception/web build
```

Expected: PASS.

### Task 7: API Client And OpenAPI Contract

**Files:**

- Modify: generated API client only through existing generation workflow if the
  repo requires it.
- Modify: `apps/api/src/contracts/openapi.generated.ts` only if this file is
  maintained manually in this repo.
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Inspect existing OpenAPI generation workflow**

Search:

```powershell
rg -n "openapi.generated|api-client|generate" apps package.json
```

Use the existing repo workflow; do not invent a generator.

- [ ] **Step 2: Update generated/manual contracts**

Ensure `thin_report` appears in the continuity entry response contract.

- [ ] **Step 3: Run contract tests**

Run:

```powershell
pnpm --filter @lunaperception/api test
```

Expected: OpenAPI contract tests pass.

### Task 8: Final Verification And Docs Status

**Files:**

- Modify: `docs/features/research-continuity/v1.4/implementation-plan.md`
- Modify: `docs/features/research-continuity/README.md`
- Modify: `docs/features/README.md`

- [ ] **Step 1: Run full verification set**

Run:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Expected: all commands pass.

- [ ] **Step 2: Update status**

When implementation is complete, change this document status from `draft` or
`goal-ready` to `implemented` and add completion notes with exact validation
commands.

- [ ] **Step 3: Commit**

Stage only V1.4-related files:

```powershell
git status --short
git add docs/features/research-continuity/v1.4/implementation-plan.md docs/features/research-continuity/README.md docs/features/README.md
git add apps/api/src/research-continuity apps/api/test/api-contract.test.ts apps/web/src/pages/ResearchContinuityPage.tsx apps/web/src/services apps/web/src/types
git commit -m "feat: add research continuity thin report"
```

## Validation Commands

Minimum implementation verification:

```powershell
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```

Optional manual UI smoke:

```powershell
pnpm dev
```

Then open `/research-continuity`, inspect a degraded BTC continuity entry, and
confirm:

- the default report is compact;
- the first section is data quality for degraded snapshots;
- rhetorical debate lines do not appear;
- debug/full JSON is not visually dominant by default;
- legacy full sections remain available for compatibility.

## Non-Goals

- No automatic backfill for old entries.
- No scheduled repair.
- No DB migration.
- No graph/timeline/provenance explorer.
- No AI prompt changes.
- No semantic embedding or similarity service.
- No PnL/outcome correctness.
- No removal of legacy fields in V1.4.

## Open Questions For Implementation

- Whether the current OpenAPI generated files are source-controlled artifacts or
  build outputs in this repo.
- Whether debug role gating can be fully enforced in V1.4 without changing
  response shape; this plan keeps legacy fields for compatibility and treats
  strict `include_debug=true` trimming as V1.5+.

## Self-Review

- Spec coverage: all grilled V1.4 decisions map to contract, renderer, storage,
  fallback, filtering, UI, and verification tasks.
- Placeholder scan: no implementation step depends on undefined behavior.
- Type consistency: `thin_report`, `payload.report_views.thin`, and
  `research_continuity_thin.v1` are used consistently.

## Execution Handoff

Plan complete and saved to:

```text
docs/features/research-continuity/v1.4/implementation-plan.md
```

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task,
   review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans,
   batch execution with checkpoints for review.
