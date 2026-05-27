# Research Continuity V1 Implementation Plan

Last updated: 2026-05-26
Status: implemented

## Goal-Ready Prompt

```text
/goal Implement Research Continuity V1 end-to-end.

Read this document first:
docs/features/research-continuity/v1/implementation-plan.md

Objective:
- Add a post-research continuity pipeline that creates a baseline or daily delta
  report for each symbol by comparing the current research run against the
  latest continuity state.

Required behavior:
- Build a structured ResearchSnapshot from a completed research run using
  existing persisted artifacts.
- Store append-only DailyContinuityEntry records for baseline, delta, degraded,
  and skipped outcomes.
- Store a small latest ContinuityState projection per workspace/symbol.
- Auto-run continuity after successful research completion when quality gates
  pass, and expose manual regenerate for a run.
- First run for a symbol creates a baseline entry, not a fake diff.
- Normal runs create a daily diff report with the agreed sections.
- Degraded entries do not overwrite top-level view unless snapshot quality is
  good enough.
- Skipped entries record a reason and do not update state.
- Use deterministic snapshot/delta/state logic as the source of truth.
- If a writer agent is added, it only writes narrative from computed events and
  must have a deterministic fallback.
- Expose continuity in the research run workspace and a symbol-level continuity
  page or panel.

Do not implement:
- Calibration, thesis outcome scoring, or market correctness claims.
- Forced 1d/7d/30d/60d/90d forecast windows for normal research reports.
- Multi-agent continuity debate.
- Full-history prompt reads over 100 raw reports.
- Semantic retrieval/RAG over historical reports.
- Weekly/monthly analytics, flip-flop score, agent consistency, or subscription
  gating.
- Broad research graph rewrites.
- New external market data provider behavior.

Definition of done:
- After a completed BTC research run, the API can create or return a continuity
  entry for that run.
- First valid BTC run creates a baseline entry and initializes continuity state.
- Second valid BTC run creates a delta entry against the previous state.
- Daily diff report includes the fixed V1 sections.
- Ledger entries are append-only; state is a rebuildable latest projection.
- Web UI shows continuity from the run workspace and can browse recent entries
  for a symbol.
- API tests, web typecheck, and API build pass, or exact blockers are
  documented.
```

## One Outcome

Build the first working Research Continuity loop:

```text
ResearchRun -> ResearchSnapshot -> DailyContinuityEntry -> ContinuityState
```

The user should be able to run research for `BTC/USDT` on day 1, establish a
baseline, run research again on day 2, and inspect a separate daily diff report
that explains what changed, what stayed valid, what became invalid, and what to
watch next.

## Verifiable End State

- [ ] A completed research run can produce exactly one latest continuity entry
      for that run unless manual regenerate is explicitly requested.
- [ ] The first valid run for a workspace/symbol creates `entry_type =
      baseline`.
- [ ] A later valid run for the same workspace/symbol creates `entry_type =
      delta`.
- [ ] `ContinuityState` is updated after clean baseline/delta entries.
- [ ] `ContinuityState` is not updated after skipped entries.
- [ ] Degraded entries are persisted and only update safe/qualified fields.
- [ ] Daily report sections are stable and readable in API and UI.
- [ ] The feature does not claim a thesis or symbol was correct/incorrect.
- [ ] Validation commands pass or blockers are documented.

## Relevant Context

Supporting materials:

- [docs/goal-skill.md](../../../goal-skill.md)
- [docs/features/README.md](../../README.md)
- [docs/web-app-implementation-roadmap.md](../../../web-app-implementation-roadmap.md)
- [docs/features/calibration-lab/v1.2.1/implementation-plan.md](../../calibration-lab/v1.2.1/implementation-plan.md)

Current repo facts:

- Research runs already persist run lifecycle, market snapshots, signal
  snapshots, debates, agent opinions, theses, scenarios, and run events.
- API research jobs run the Python engine, sync SQLite journal data to
  Postgres, then mark the job completed.
- Comparisons currently provide pairwise run/thesis diffs, not a durable
  continuity memory layer.
- Daily briefs have limited previous-brief comparison, but not symbol-level
  research continuity.
- Calibration evaluates thesis outcomes after a maturity window. This feature
  must not duplicate that.

Files to inspect first:

```text
apps/api/src/jobs/research-job.processor.ts
apps/api/src/research-runs/research-runs.service.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/database/prisma-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/test/api-contract.test.ts
apps/web/src/routes/index.tsx
apps/web/src/lib/routes.ts
apps/web/src/navigation/nav-groups.ts
apps/web/src/pages/ResearchRunWorkspacePage.tsx
apps/web/src/services/research-runs.ts
apps/web/src/types/index.ts
packages/database/prisma/schema.prisma
apps/api/src/database/postgres-schema.sql
```

Likely files to create:

```text
apps/api/src/research-continuity/research-continuity.module.ts
apps/api/src/research-continuity/research-continuity.controller.ts
apps/api/src/research-continuity/research-continuity.service.ts
apps/api/src/research-continuity/research-snapshot.builder.ts
apps/api/src/research-continuity/continuity-delta.engine.ts
apps/api/src/research-continuity/continuity-state.projector.ts
apps/api/src/research-continuity/continuity-report.renderer.ts
apps/api/src/research-continuity/dto/research-continuity.dto.ts
apps/web/src/pages/ResearchContinuityPage.tsx
apps/web/src/services/research-continuity.ts
```

Likely files to modify:

```text
apps/api/src/app.module.ts
apps/api/src/jobs/research-job.processor.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/database/prisma-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/routes/index.tsx
apps/web/src/lib/routes.ts
apps/web/src/navigation/nav-groups.ts
apps/web/src/pages/ResearchRunWorkspacePage.tsx
apps/web/src/services/generated/api-client.ts
apps/web/src/types/index.ts
packages/database/prisma/schema.prisma
apps/api/src/database/postgres-schema.sql
docs/features/README.md
docs/features/research-continuity/README.md
```

## Resolved Decisions

- Feature name: Research Continuity.
- User-facing report name: Daily Research Delta.
- Unit of continuity: workspace + symbol.
- Source of truth: append-only continuity ledger.
- Latest state: rebuildable projection/cache.
- First run behavior: baseline, not diff.
- V1 report format: fixed daily diff sections.
- V1 snapshot horizon: soft `time_context`, not forced 7d/30d windows.
- V1 agent system: deterministic-first with optional narrative writer.
- V1 context limit for writer: current snapshot, latest state, computed events,
  previous entry, and at most three recent entries.
- V1 does not run analytics over full history.

## Terminology

Use these terms in API, UI, and docs:

```text
Research Continuity
Daily Research Delta
Research Snapshot
Continuity Entry
Continuity Ledger
Continuity State
Baseline
Delta
Degraded
Skipped
```

Avoid these terms for this feature:

```text
symbol evaluation
symbol correctness
market verdict
thesis hit/miss
calibration score
prediction accuracy
```

## Data Model

### ResearchSnapshot

One structured snapshot per research run when enough artifacts exist.

Recommended Prisma model shape:

```text
ResearchSnapshot
  id
  workspace_id
  research_run_id
  symbol
  captured_at
  time_context
  symbol_view_json
  tracked_items_json
  data_quality_json
  source_artifacts_json
  payload_json
```

Recommended indexes:

```text
unique(workspace_id, research_run_id)
index(workspace_id, symbol, captured_at desc)
```

`symbol_view_json` should contain:

```json
{
  "directional_bias": "neutral",
  "risk_posture": "cautious",
  "conviction": "medium",
  "time_context": "daily_context"
}
```

Allowed `directional_bias`:

```text
bearish
cautious_bearish
neutral
mixed
cautious_bullish
bullish
unclear
```

Allowed `risk_posture`:

```text
defensive
cautious
balanced
opportunistic
aggressive
unclear
```

Allowed `conviction`:

```text
low
medium
high
unclear
```

Allowed `time_context`:

```text
unspecified
daily_context
swing_context
long_context
multi
```

`tracked_items_json` should contain items like:

```json
[
  {
    "item_key": "risk:funding_overheating",
    "type": "risk",
    "status": "active",
    "text": "Funding is becoming crowded.",
    "importance": "medium",
    "evidence": ["funding rate elevated"],
    "source_artifact": "agent_opinion",
    "source_id": "op_123"
  }
]
```

Allowed item types:

```text
claim
risk
watchpoint
level
invalidation
```

Allowed item status:

```text
active
reinforced
weakened
invalidated
resolved
stale
```

V1 `item_key` may be deterministic from type plus normalized text/category and
optional price level. If matching is uncertain, store
`match_confidence = "uncertain"` and do not treat it as the same item.

### DailyContinuityEntry

Append-only record created for every generated, degraded, or skipped continuity
attempt.

Recommended Prisma model shape:

```text
ResearchContinuityEntry
  id
  workspace_id
  symbol
  research_run_id
  current_snapshot_id
  previous_entry_id
  entry_type
  status
  generated_at
  summary
  sections_json
  events_json
  snapshot_quality_json
  source_run_ids_json
  writer_metadata_json
  payload_json
```

Recommended indexes:

```text
index(workspace_id, symbol, generated_at desc)
index(workspace_id, research_run_id)
```

Allowed `entry_type`:

```text
baseline
delta
degraded
skipped
```

Allowed `status`:

```text
completed
degraded
skipped
failed
```

`events_json` is the structured source for the report:

```json
[
  {
    "event_type": "view_changed",
    "severity": "medium",
    "from": {
      "directional_bias": "neutral",
      "risk_posture": "defensive"
    },
    "to": {
      "directional_bias": "cautious_bullish",
      "risk_posture": "cautious"
    },
    "item_key": null,
    "reason": "Consensus stance improved and market structure was reclaimed."
  }
]
```

V1 event types:

```text
baseline_initialized
view_observed
view_changed
claim_added
claim_reinforced
claim_weakened
risk_added
risk_reinforced
risk_resolved
watchpoint_added
watchpoint_carried
watchpoint_resolved
level_added
level_invalidated
invalidation_added
data_quality_changed
agent_conflict_changed
continuity_skipped
```

### ContinuityState

Small latest projection for the next run. It should not contain the full
history.

Recommended Prisma model shape:

```text
ResearchContinuityState
  id
  workspace_id
  symbol
  current_snapshot_id
  latest_entry_id
  latest_run_id
  current_view_json
  active_items_json
  recent_resolved_items_json
  recent_invalidated_items_json
  data_quality_json
  updated_at
  payload_json
```

Recommended indexes:

```text
unique(workspace_id, symbol)
index(workspace_id, updated_at desc)
```

Do not store long timeline analytics here. Query those from the ledger in later
versions.

## Pipeline Behavior

### Trigger

V1 should support:

```text
auto-run after research job completion
manual regenerate for one run
```

Auto-run should happen after the engine result is synced to Postgres and the job
is marked completed or completed_degraded.

Quality gate:

```text
run has workspace_id
run has symbol
run status is completed or completed_degraded
at least one structured artifact exists:
  debate
  thesis
  market snapshot + signal snapshot
snapshot builder returns quality above the skipped threshold
```

If quality is insufficient, create a skipped entry with reason
`insufficient_structured_data` and do not update state.

### Snapshot Builder

Build `ResearchSnapshot` from existing artifacts in this priority:

```text
ResearchDebate consensus stance/conflict
AgentOpinion stance/confidence/risks/invalidation
TradeThesis structured_summary, direction, confidence, risks, monitor_next
MarketSnapshot payload
SignalSnapshot counts/payload
ResearchRun degradation and missing data
```

Raw report text is not default input in V1. It may be used only as a fallback if
the existing artifact path cannot create any useful snapshot, and the snapshot
must be marked low quality.

### Delta Engine

Compare:

```text
current ResearchSnapshot
vs
latest ContinuityState for workspace/symbol
```

For first valid run:

```text
create baseline entry
initialize state
```

For later valid run:

```text
compute deterministic events
create delta entry
update state
```

Minimum deterministic comparisons:

```text
symbol_view changed
tracked item added
tracked item carried forward
tracked item reinforced
tracked item weakened
tracked item resolved
tracked item invalidated
data quality changed
agent conflict changed
```

### State Update Rules

```text
clean baseline/delta -> update state
degraded -> append entry, update only safe/qualified fields
skipped -> append skipped record, do not update state
failed -> record failure if useful, do not update state
```

Degraded entries must not overwrite `current_view_json` unless snapshot quality
is above the top-level-view threshold.

### Writer

V1 must have a deterministic report renderer. Optional LLM writing can be added
only if it follows these rules:

```text
input = current snapshot + latest state + computed events + previous entry +
        at most three recent entries
no full ledger in prompt
no raw report text by default
no new source-of-truth events
no correctness claims
deterministic fallback required
```

If an LLM writer fails, save the deterministic report and include writer
metadata:

```json
{
  "writer_source": "deterministic_fallback",
  "llm_error": "..."
}
```

## Daily Report Format

Every V1 continuity report should expose these sections:

```text
1. Summary
2. View Change
3. What Changed
4. What Stayed Valid
5. What Became Invalid / Less Useful
6. New Risks
7. Resolved or Reduced Risks
8. Watch Next
9. Data Quality / Limitations
```

Empty sections should render a stable empty state such as:

```text
No material changes detected.
No resolved risks in this run.
No new limitations reported.
```

## API Contract

Recommended endpoints:

```text
GET  /research-continuity/symbols/:symbol/state
GET  /research-continuity/symbols/:symbol/entries?limit=20
GET  /research-continuity/entries/:id
GET  /research-runs/:id/continuity
POST /research-runs/:id/continuity
```

Endpoint behavior:

```text
GET /research-runs/:id/continuity
  Return the latest entry for the run, or null-like not_found response if none.

POST /research-runs/:id/continuity
  Generate or regenerate continuity for the run.
  Requires editor access.
  Should be idempotent by default for the latest entry unless force=true.

GET /research-continuity/symbols/:symbol/state
  Return latest state and latest entry pointer for workspace/symbol.

GET /research-continuity/symbols/:symbol/entries
  Return recent append-only entries in reverse chronological order.
```

Use workspace access rules consistent with existing research run APIs.

## UI UX

V1 should surface continuity in two places:

```text
Research Run Workspace
  A "Daily Delta" panel for that run.

Research Continuity Page
  A symbol-focused page for latest state and recent entries.
```

Recommended route:

```text
/research/continuity
```

Recommended nav placement:

```text
Luna Research -> Continuity
```

The run workspace panel should show:

```text
entry type/status
summary
daily report sections
source run id
previous entry link if available
manual regenerate button for editors
```

The continuity page should show:

```text
symbol selector
latest state
current view
active tracked items
recent entries
open run link
open raw JSON/details drawer
```

Do not build long-range analytics charts in V1.

## Constraints And Non-Goals

Explicitly do not:

- Evaluate symbol correctness.
- Evaluate thesis outcomes.
- Add forced forecast windows to normal research reports.
- Read all historical reports into an LLM prompt.
- Add semantic search/RAG.
- Build weekly/monthly summaries.
- Build flip-flop score or recurring risk analytics.
- Rewrite the Python research graph.
- Add new provider fetching behavior.
- Add subscription/paywall logic.
- Revert unrelated dirty worktree changes.

## Implementation Checklist

- [ ] Add database schema for research snapshots, continuity entries, and
      continuity state.
- [ ] Add repository methods for snapshot/state/entry save and read operations.
- [ ] Add API response types and OpenAPI contract updates.
- [ ] Implement deterministic `ResearchSnapshotBuilder`.
- [ ] Implement deterministic `ContinuityDeltaEngine`.
- [ ] Implement `ContinuityStateProjector`.
- [ ] Implement deterministic daily report renderer.
- [ ] Implement `ResearchContinuityService`.
- [ ] Implement controller endpoints.
- [ ] Wire auto-run after research completion and Postgres sync.
- [ ] Wire manual regenerate endpoint.
- [ ] Add API contract tests for baseline, delta, degraded, skipped, and access.
- [ ] Add web service client/types.
- [ ] Add run workspace Daily Delta panel.
- [ ] Add Research Continuity page and nav entry.
- [ ] Update feature registry/docs if implementation changes scope.
- [ ] Run validation commands.

## Required Tests

API tests:

- [ ] First valid run for `BTC/USDT` creates baseline entry.
- [ ] Second valid run for `BTC/USDT` creates delta entry.
- [ ] Baseline initializes state.
- [ ] Delta updates state.
- [ ] Skipped entry does not update state.
- [ ] Degraded entry does not overwrite top-level view below quality threshold.
- [ ] Manual regenerate returns existing entry by default when no force flag is
      provided.
- [ ] Manual regenerate with force creates a new append-only entry or clearly
      records a new attempt according to the implementation's chosen policy.
- [ ] `GET /research-runs/:id/continuity` returns the run entry.
- [ ] `GET /research-continuity/symbols/:symbol/state` returns latest state.
- [ ] `GET /research-continuity/symbols/:symbol/entries` returns recent entries.
- [ ] Viewer can read; editor is required to generate/regenerate.
- [ ] API output contains the nine daily report sections.
- [ ] No response field claims symbol correctness or thesis correctness.

Web checks:

- [ ] Typecheck passes.
- [ ] Research run workspace renders Daily Delta panel with empty state when no
      continuity entry exists.
- [ ] Research run workspace renders baseline and delta entries.
- [ ] Continuity page can filter/select `BTC/USDT`.
- [ ] Manual regenerate button calls the correct endpoint for editors.
- [ ] UI copy uses Research Continuity / Daily Delta language, not Calibration.

## Validation Loop

Automated checks:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Start API and web dev servers if they are not already running.
- Run or use existing completed research runs for one symbol, such as
  `BTC/USDT`.
- Generate continuity for the first run and confirm it is baseline.
- Generate continuity for a later run and confirm it is delta.
- Open the research run workspace and confirm the Daily Delta panel renders.
- Open `/research/continuity` and confirm latest state plus recent entries
  render.
- Confirm no page says the symbol or thesis was correct/incorrect.

## Checkpoint Behavior

Work milestone by milestone:

1. Database schema and repository methods.
2. Snapshot builder and quality gate.
3. Delta engine and state projector.
4. Deterministic report renderer.
5. API endpoints and auto-run trigger.
6. API tests.
7. Web services and UI panels.
8. Final validation and docs cleanup.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- keep a short progress log;
- preserve unrelated dirty worktree changes;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- the V1 continuity loop is implemented and validation passes;
- the next change would require Calibration behavior;
- the next change would require long-range analytics;
- the next change would require reading full historical reports into LLM
  context;
- the next change would require broad research graph rewrites;
- required persisted research artifacts are missing and cannot be inferred
  safely;
- validation fails because of an external/environment blocker.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/research-continuity/v1/implementation-plan.md first and
treat it as the source of truth for Research Continuity V1.

Implement only the V1 post-research continuity loop. Build structured
ResearchSnapshot artifacts from existing persisted research outputs, append
DailyContinuityEntry records, maintain latest ContinuityState projection, expose
API routes, and show Daily Delta in the web app.

Do not implement Calibration behavior, thesis correctness, symbol correctness,
forced forecast windows, multi-agent continuity debate, semantic retrieval,
weekly/monthly analytics, subscription gating, or broad research graph rewrites.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, Prisma, contract, React Query, routing, and CSS patterns.
Preserve unrelated dirty worktree changes.
```

## Definition Of Done

- Research Continuity has durable snapshot, entry, and state storage.
- First valid run for a symbol creates a baseline entry.
- Later valid runs create daily delta entries.
- Daily delta report uses the nine-section V1 format.
- Continuity state is small, current, and rebuildable from ledger history.
- Skipped/degraded behavior is explicit and safe.
- Auto-run after research completion works after Postgres sync.
- Manual regenerate works with editor access.
- Research run workspace surfaces the relevant continuity entry.
- Symbol continuity page shows latest state and recent entries.
- API tests and web typecheck pass, or blockers are documented.
