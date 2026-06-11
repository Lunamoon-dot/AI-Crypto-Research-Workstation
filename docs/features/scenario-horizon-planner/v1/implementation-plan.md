# Scenario Horizon Planner V1 Implementation Plan

Last updated: 2026-06-10
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Scenario Horizon Planner V1 end-to-end.

Read this document first:
docs/features/scenario-horizon-planner/v1/implementation-plan.md

Objective:
- Refactor the existing Scenario Planner into one orchestration node that emits
  exactly three horizon-specific scenarios, persists horizon identity end to
  end, uses Portfolio Manager continuity handoff for prior-memory guidance, and
  exposes horizon-aware scenario browsing in the web UI.

Required behavior:
- Keep one public `Scenario Planner` graph node and one `ScenarioPlan` output.
- The planner internally runs three horizon-specialized scenario generators with
  distinct prompt policies.
- The structured scenario contract carries horizon metadata so downstream
  persistence and continuity can distinguish short/mid/long scenarios.
- Existing scenario read surfaces expose horizon metadata so web clients can
  filter short-term, mid-term, and long-term scenarios.
- The planner still uses current reports, investment plan, and Portfolio
  Manager decision as the primary evidence layer.
- Prior continuity, when used for scenario planning, enters only through a
  Portfolio Manager-authored scenario handoff, not raw continuity injection.
- The Portfolio Manager can summarize how prior continuity should influence
  short/mid/long scenario planning without turning continuity into current
  evidence.
- Journal persistence, markdown rendering, and fallback behavior remain
  compatible with the existing scenario save flow.
- Thesis detail and scenario-monitor UI can filter by horizon without requiring
  a new route or duplicated scenario-fetch path.
- The planner applies horizon-aware validation and consistency rules before it
  finalizes the normalized scenario plan.
- Continuity scenario surfaces can display horizon-aware scenario memory without
  requiring a new continuity endpoint.

Do not implement:
- Three new top-level graph nodes for scenario generation.
- Direct raw `latest_continuity_context` injection into horizon prompts.
- A new public API route or a new scenario database table.
- Calibration, outcome evaluation, or automatic trade execution behavior.
- Provider/model fan-out beyond what the current Scenario Planner boundary can
  support cleanly.
- A separate scenario-horizon service layer for web state if existing scenario
  fetches can carry the metadata.

Definition of done:
- `Scenario Planner` returns exactly three structured scenario entries with
  stable short/mid/long horizon identity.
- Structured JSON, markdown rendering, and journal persistence keep working
  without breaking current scenario consumers.
- Web scenario surfaces can filter short/mid/long scenarios using the same
  scenario data they already fetch.
- Portfolio Manager hands scenario planning a compact continuity-aware horizon
  handoff instead of exposing raw continuity state directly.
- Horizon-aware validation and consistency rules run inside the planner and are
  covered by focused tests.
- Continuity-facing scenario state can preserve horizon identity across runs and
  UI inspection paths that already show scenario continuity.
- Focused tests cover prompt specialization, schema normalization, journal
  mapping, and planner fallback/consistency behavior.
- The plan preserves current graph/node boundaries and documents any exact
  follow-up scope left for later versions.
```

## One Outcome

Convert the current scenario generation stage into a horizon-aware planner that
always returns one short-term, one mid-term, and one long-term scenario while
preserving the existing graph contract and carrying horizon identity through
Portfolio Manager handoff, scenario persistence, continuity surfaces, and web
browsing surfaces.

V1 should let the system answer:

```text
What is the tactical short-term branch for this thesis?
What is the medium-term thesis follow-through branch?
What is the long-term structural branch?
```

without turning Scenario Planner into three graph nodes or breaking continuity
and journal integrations.

## Verifiable End State

- [ ] `ScenarioPlan` can represent horizon identity for every structured
      scenario item.
- [ ] `create_scenario_planner()` still registers one node and returns one
      normalized `ScenarioPlan`.
- [ ] The planner emits exactly three scenarios for structured output:
      short-term, mid-term, and long-term.
- [ ] Each horizon uses a distinct prompt policy appropriate to its timeframe.
- [ ] Current evidence remains primary; continuity prior, if present, enters
      through a PM-authored scenario handoff only.
- [ ] Portfolio Manager output/state can carry a compact
      `scenario_continuity_handoff` shape for scenario planning.
- [ ] `render_scenario_plan()` renders horizon-aware markdown without breaking
      journal parsing or downstream display.
- [ ] `scenarios_from_structured_plan()` persists horizon-tagged scenarios
      without requiring a new table or endpoint.
- [ ] Existing scenario API/web contracts can carry horizon metadata through
      current fetch paths.
- [ ] Thesis detail scenario radar can filter `short_term`, `mid_term`, and
      `long_term`.
- [ ] Scenario monitor can filter `short_term`, `mid_term`, and `long_term`.
- [ ] Continuity scenario projections and current-view/lifecycle surfaces can
      preserve and expose horizon identity where scenario memory is already
      shown.
- [ ] The planner enforces horizon consistency rules and degrades safely when
      one horizon is weak or missing.
- [ ] Focused AI-service tests pass for schema, planner behavior, journal
      mapping, fallback handling, and web filter behavior, or exact blockers are
      documented.

## Scope Consolidation

```text
Previous idea split:
- generic scenario planner
- planner orchestration only
- continuity handoff later
- validators/scoring later
- richer UI later

This V1 deliberately consolidates all of those into one delivery slice:
- one planner node that orchestrates short/mid/long specialists
- PM continuity handoff for scenario planning
- horizon-aware validation and consistency logic
- horizon metadata preserved through persistence and continuity
- FE horizon filtering and baseline horizon-aware scenario surfaces
```

This V1 is intentionally broader than a prompt-only refactor, but it still must
not absorb graph-wide node refactors, new public APIs, calibration logic, or a
new scenario storage subsystem.

## Relevant Context

Supporting materials:

- [docs/goal-skill.md](../../../goal-skill.md)
- [docs/agent/scenario-planner.md](../../../agent/scenario-planner.md)
- [docs/agent/portfolio-manager.md](../../../agent/portfolio-manager.md)
- [docs/features/research-continuity/README.md](../../research-continuity/README.md)
- [docs/features/research-continuity/v2.1/implementation-plan.md](../../research-continuity/v2.1/implementation-plan.md)
- [docs/superpowers/plans/2026-06-04-scenario-continuity-bridge.md](../../../superpowers/plans/2026-06-04-scenario-continuity-bridge.md)
- [docs/frontend-system-design.md](../../../frontend-system-design.md)
- [docs/web-app-implementation-roadmap.md](../../../web-app-implementation-roadmap.md)

Files to inspect first:

```text
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
apps/ai-service/luna_workstation/agents/schemas.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
apps/ai-service/luna_workstation/agents/utils/agent_states.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/tests/test_structured_agents.py
apps/ai-service/tests/test_journal_bridge_scenarios.py
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/research-continuity-current-view.ts
apps/web/src/pages/research-continuity-lifecycle.ts
apps/web/src/services/generated/api-client.ts
apps/web/test/thesis-detail-layout.test.ts
apps/web/test/scenario-monitor-layout.test.ts
apps/web/test/research-continuity-current-view.test.ts
apps/web/test/research-continuity-lifecycle.test.ts
```

Likely files to change:

```text
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
apps/ai-service/luna_workstation/agents/planners/scenario_horizon_prompts.py
apps/ai-service/luna_workstation/agents/planners/scenario_horizon_runner.py
apps/ai-service/luna_workstation/agents/schemas.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
apps/ai-service/luna_workstation/agents/utils/agent_states.py
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/tests/test_structured_agents.py
apps/ai-service/tests/test_journal_bridge_scenarios.py
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/scenario-view-model.ts
apps/web/src/pages/research-continuity-current-view.ts
apps/web/src/pages/research-continuity-lifecycle.ts
apps/web/test/thesis-detail-layout.test.ts
apps/web/test/scenario-monitor-layout.test.ts
apps/web/test/research-continuity-current-view.test.ts
apps/web/test/research-continuity-lifecycle.test.ts
```

## Resolved Decisions

- Keep `Scenario Planner` as one public graph node.
- The parent planner is an orchestrator/normalizer, not just one monolithic
  prompt.
- Use three fixed horizons:

```text
short_term
mid_term
long_term
```

- Prefer one normalized public `ScenarioPlan` contract over three new public
  output contracts.
- Preserve current journal save flow and scenario parsing behavior where
  possible.
- Use existing scenario read paths for FE filtering instead of adding a
  scenario-horizon-only endpoint.
- Put continuity interpretation responsibility on Portfolio Manager first, then
  hand scenario-relevant prior-memory guidance to Scenario Planner.
- Add validation/consistency rules in V1 rather than deferring them to a later
  version, because horizon fan-out without reconciliation would weaken output
  quality.
- Add FE horizon filtering and baseline continuity horizon exposure in V1 rather
  than deferring them, because horizon identity without a visible inspection
  path would be low-value product work.
- Do not let raw continuity state bypass Portfolio Manager and reach horizon
  prompts directly.

## Architecture

V1 should introduce an internal planner structure like this:

```text
Scenario Planner node
  -> collect shared context
  -> validate setup template once
  -> read PM scenario continuity handoff
  -> build short-term prompt
  -> build mid-term prompt
  -> build long-term prompt
  -> invoke three horizon-specialized runs
  -> normalize outputs into one ScenarioPlan
  -> apply horizon consistency checks
  -> render markdown
  -> persist through existing journal bridge
  -> expose horizon metadata through existing scenario read contracts
```

Shared context stays centralized in the parent planner:

- `company_of_interest`
- `investment_plan`
- `final_trade_decision`
- research reports
- signal text
- template validation result
- analysis date / date-grounding instruction
- optional PM-authored `scenario_continuity_handoff`

Horizon responsibilities:

- `short_term`
  - tactical branch
  - near-term trigger and invalidation
  - liquidity, event, or reaction context
- `mid_term`
  - thesis follow-through branch
  - catalyst path over weeks
  - confirmation vs weakening path
- `long_term`
  - structural branch
  - regime durability
  - deeper invalidation / persistence logic

Portfolio Manager handoff responsibilities:

- summarize whether the prior thesis continues, weakens, invalidates, or is
  superseded;
- point each horizon at the most relevant carry-forward watchpoints and
  invalidations;
- keep prior continuity memory subordinate to current evidence and current final
  decision.

Web responsibilities:

- thesis detail renders scenario cards with horizon metadata and local horizon
  filter controls;
- scenario monitor filters current scenarios by horizon using existing monitor
  data;
- continuity current view and lifecycle can label or group scenario memory with
  preserved horizon identity where scenario memory is already shown.

## Proposed Data Contract

V1 should extend `ScenarioItem`, not replace `ScenarioPlan`.

Add:

```python
class ScenarioHorizon(str, Enum):
    SHORT_TERM = "short_term"
    MID_TERM = "mid_term"
    LONG_TERM = "long_term"
```

```python
horizon: ScenarioHorizon
timeframe_label: str
```

V1 should also add a compact PM-authored handoff shape, for example:

```python
scenario_continuity_handoff: dict[str, Any] | None
```

Suggested contents:

```text
continuity_relation
summary
short_term_focus
mid_term_focus
long_term_focus
carry_forward_watchpoints
carry_forward_invalidations
stale_prior
```

Contract rules:

- `ScenarioPlan.scenarios` must contain exactly three items after
  normalization.
- Exactly one item per horizon.
- Existing fields such as `scenario_name`, `direction`, `condition`,
  `expected_behavior`, `evidence`, `watch_triggers`, `invalidation`,
  `probability_band`, `risk_factors`, and `suggested_action` remain part of the
  public contract.
- `timeframe` remains the evidence timeframe field already used for provenance.
  `timeframe_label` is the human-readable horizon window such as `24-72h`,
  `1-3w`, or `1-3m`.
- Horizon identity should be available in the persisted scenario payload and, if
  possible without breaking compatibility, as a top-level response field so FE
  filtering does not need to infer it from text labels.
- Existing fallback scenarios that lack horizon metadata should remain readable;
  they may be shown as `unknown`/unfiltered legacy rows until re-generated.

## Contract Decision

V1 should explicitly choose this contract shape:

```text
structured planner output
  -> horizon in ScenarioItem
  -> horizon mirrored into persisted scenario payload
  -> horizon exposed as a top-level API response field
  -> FE filters use the top-level field first
```

Recommended rationale:

- top-level `horizon` gives FE and service code a stable, obvious field;
- payload mirror preserves backward-compatible access for older parsing and
  persistence paths that already rely on `payload`;
- keeping both avoids brittle text inference and avoids forcing every consumer
  to drill into raw JSON blobs.

### Structured Planner Contract

The normalized planner contract should look like:

```python
class ScenarioHorizon(str, Enum):
    SHORT_TERM = "short_term"
    MID_TERM = "mid_term"
    LONG_TERM = "long_term"


class ScenarioItem(BaseModel):
    horizon: ScenarioHorizon
    timeframe_label: str
    scenario_name: str
    direction: str
    thesis_impact: str
    condition: str
    expected_behavior: str
    evidence: list[str]
    watch_triggers: list[str]
    impact_on_thesis: str
    probability_band: str
    invalidation: str
    risk_factors: list[str]
    suggested_action: str
    as_of: str
    timeframe: str
    source: list[str]
```

Normalization rules:

- `horizon` is required after planner normalization;
- `timeframe_label` is required after planner normalization;
- planner output is invalid if two scenarios share the same `horizon`;
- planner output is invalid if any required horizon is missing;
- planner output is invalid if it contains more than three final normalized
  scenario items.

### Persistence Contract

Structured scenario persistence should preserve horizon in two places:

1. domain-visible field when possible through response mapping
2. persisted payload mirror for backward compatibility

Recommended persisted payload additions:

```json
{
  "horizon": "short_term",
  "timeframe_label": "24-72h",
  "branch_type": "confirmation",
  "scenario_name": "Short-term reclaim setup"
}
```

Persistence rules:

- `payload.horizon` stores the canonical horizon value;
- `payload.timeframe_label` stores the human-readable horizon window;
- existing fields such as `branch_type`, `invalidation`, `risk_factors`, and
  provenance data remain additive and unchanged where possible;
- no new scenario table or scenario-horizon join structure is introduced.

### API Response Contract

For read paths that already return scenario rows, V1 should expose:

```ts
type ScenarioHorizon = 'short_term' | 'mid_term' | 'long_term' | 'unknown';

interface ScenarioResponse {
  id: string;
  thesis_id: string;
  scenario_name: string;
  direction: string;
  thesis_impact: string;
  condition: string;
  expected_behavior: string;
  probability_band: string;
  invalidation: string;
  horizon: ScenarioHorizon;
  timeframe_label: string | null;
  payload: Record<string, unknown>;
  runtime_decision: ScenarioRuntimeDecision;
  ...
}
```

API mapping rules:

- top-level `horizon` is the primary field for clients;
- top-level `timeframe_label` is the primary human-readable horizon label for
  clients;
- if `payload.horizon` exists but top-level `horizon` is absent in legacy code,
  service mapping should lift it to top-level;
- if neither exists, map `horizon` to `unknown` and keep the row readable;
- current endpoints such as thesis scenarios and scenario monitor should reuse
  this contract instead of adding horizon-specific endpoints.

### FE Contract

FE should treat `scenario.horizon` as the source of truth.

Filter model:

```ts
type ScenarioHorizonFilter = 'all' | 'short_term' | 'mid_term' | 'long_term' | 'unknown';
```

FE rules:

- filter against top-level `scenario.horizon`;
- use `payload.horizon` only as an internal fallback for legacy responses during
  migration;
- do not infer horizon from title, timeframe text, branch type, or condition;
- show `unknown` only when legacy or degraded data lacks horizon metadata;
- default page state should remain `all` unless product explicitly wants a
  pinned horizon.

### Continuity Contract

Where continuity already carries scenario memory, horizon identity should be
preserved in scenario-bearing structures.

Recommended scenario branch/state additions:

```json
{
  "scenario_key": "thesis_1:short_term:confirmation:if-btc-reclaims-108k",
  "scenario_id": "scenario_1",
  "horizon": "short_term",
  "timeframe_label": "24-72h",
  "condition": "If BTC reclaims 108k on acceptance",
  "probability_band": "medium"
}
```

Continuity rules:

- `scenario_branches` should preserve `horizon` and `timeframe_label`;
- `active_scenarios`, `recent_resolved_scenarios`, and
  `recent_invalidated_scenarios` should preserve `horizon`;
- continuity UI should never reconstruct horizon heuristically from free text if
  stored scenario metadata already provides it.

## Validation And Consistency Rules

V1 should not rely on prompt quality alone.

The planner should enforce at least these rules:

- exactly one normalized scenario per horizon;
- no duplicate horizon values;
- no empty `condition` or `expected_behavior` after normalization;
- no obviously duplicated `condition` text across all three horizons unless a
  reconciliation note explains why one trigger remains relevant across
  horizons;
- `short_term` emphasizes tactical reaction and near-term invalidation;
- `mid_term` emphasizes thesis follow-through and catalyst path;
- `long_term` emphasizes structural durability and deeper invalidation;
- if one horizon conflicts with another, the final normalized plan should keep
  the conflict explicit instead of silently flattening it;
- if a horizon call is unusable, the planner should prefer a bounded
  deterministic fallback for that horizon over collapsing the whole scenario
  stage when the rest of the plan remains valid.

Optional V1 scoring is allowed if it stays local to the planner:

- completeness score per horizon
- evidence coverage warning
- consistency warning list

Those scores must not become a new public analytics subsystem.

## Constraints And Non-Goals

Explicitly do not:

- create three new LangGraph stages for scenario generation;
- add a new scenario persistence table or migration just for horizons;
- add a new UI route just for horizon filtering;
- treat continuity as direct current evidence in scenario prompts;
- refactor unrelated planner, thesis, watchlist, or continuity code;
- redesign web UI beyond the minimal filter controls and label exposure needed
  for horizon-aware scenario browsing;
- build a generic multi-agent orchestration framework beyond the scenario
  planner’s internal needs;
- turn scenario continuity into a separate product surface with its own API in
  this version.

## Validation Loop

Automated checks:

```bash
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_structured_agents.py -q
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_journal_bridge_scenarios.py -q
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_budget_tracking.py -q
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_phase34_hardening.py -q
corepack pnpm test -- --runInBand apps/web/test/thesis-detail-layout.test.ts apps/web/test/scenario-monitor-layout.test.ts
corepack pnpm test -- --runInBand apps/web/test/research-continuity-current-view.test.ts apps/web/test/research-continuity-lifecycle.test.ts
.\.venv\Scripts\python.exe -m ruff check apps/ai-service/luna_workstation/agents/planners/scenario_planner.py apps/ai-service/luna_workstation/agents/schemas.py apps/ai-service/luna_workstation/graph/journal_bridge.py apps/ai-service/tests/test_structured_agents.py apps/ai-service/tests/test_journal_bridge_scenarios.py
```

Manual checks:

- Inspect one rendered `scenario_plan` markdown block and confirm it shows
  short/mid/long horizon identity clearly.
- Inspect one `scenario_plan_json` payload and confirm there are exactly three
  horizon-tagged scenario items.
- Inspect one PM output/state snapshot and confirm the scenario continuity
  handoff is compact and prior-memory-only.
- Run one local research flow if available and confirm journal persistence still
  saves scenarios without degraded parsing.
- Open thesis detail and confirm the scenario radar can filter short/mid/long.
- Open scenario monitor and confirm the horizon filter changes the visible
  scenario list without a refetch-only workaround.
- Open a continuity surface that already shows scenario memory and confirm
  horizon identity is visible when scenario branches are present.

## Checkpoint Behavior

Work milestone by milestone:

1. Lock the structured scenario contract for horizon identity.
2. Add PM continuity handoff for scenario planning.
3. Refactor the planner into shared context plus three horizon-specialized runs.
4. Normalize, validate, and render a stable three-horizon `ScenarioPlan`.
5. Keep journal persistence and fallback handling compatible.
6. Expose horizon metadata through current FE and continuity scenario surfaces.
7. Add or update focused tests around schema, planner prompts, handoff,
   journal save behavior, continuity surfaces, and FE filtering.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- keep a short progress log;
- stop only when the objective is met or a blocker is explicit.

## Implementation Slices

### Slice 1: Lock the scenario horizon contract

Expected deliverable:

- `ScenarioItem` can carry horizon identity.
- Existing render and persistence code can read that identity without breaking
  older fields.

Suggested tests:

- `test_structured_agents.py`
  - structured plan accepts `horizon` and `timeframe_label`
  - planner output contains exactly three items after normalization
- `test_journal_bridge_scenarios.py`
  - structured plan mapping preserves horizon information

### Slice 2: Add PM continuity handoff for scenario planning

Expected deliverable:

- Portfolio Manager can prepare a compact scenario-planning handoff from prior
  continuity memory.
- Scenario Planner can read that handoff without reading raw continuity state.

Suggested rules:

- The handoff is advisory prior memory only.
- The handoff should be bounded and horizon-oriented, not a copied continuity
  report.
- The handoff should be optional and degrade cleanly when continuity is absent.

### Slice 3: Introduce internal horizon specialization

Expected deliverable:

- Parent planner builds shared context once.
- Horizon-specific prompt builders exist for short/mid/long.
- Planner still returns one `ScenarioPlan`.

Suggested rules:

- Template validation runs once in the parent planner.
- Date grounding runs after normalization, not independently per horizon with
  diverging behavior.
- Shared evidence block construction remains centralized.

### Slice 4: Add validation, reconciliation, and safe fallback behavior

Expected deliverable:

- The normalized three-horizon plan is structurally valid and internally
  coherent enough to trust as a product surface.
- Missing/weak horizon outputs do not automatically collapse the whole stage.

Suggested rules:

- If one horizon run fails but the planner can still produce a valid normalized
  three-horizon plan, prefer deterministic fallback for the missing horizon over
  failing the whole node.
- If structured output fails globally, keep the current free-text fallback path,
  but document exact V1 fallback expectations.
- Reconciliation should be minimal and inspectable, not a second opaque LLM
  rewrite pass.

### Slice 5: Preserve compatibility for persistence and continuity

Expected deliverable:

- Markdown rendering remains parseable and readable.
- Journal persistence still saves structured scenarios.
- Continuity snapshot/state/detail flows can preserve scenario horizon identity
  where they already handle scenarios.
- Fail-open behavior remains unchanged at the graph boundary.

Suggested rules:

- Prefer additive payload fields over storage shape replacement.
- Do not break existing scenario parsing for legacy rows.
- If continuity needs horizon labels, add them through existing snapshot/state
  scenario structures instead of inventing a parallel scenario-memory model.

### Slice 6: Add FE horizon filtering and baseline continuity horizon surfaces

Expected deliverable:

- Thesis detail scenario radar can filter by `short_term`, `mid_term`, and
  `long_term`.
- Scenario monitor can filter by `short_term`, `mid_term`, and `long_term`.
- Continuity views that already render scenarios can show horizon identity and
  filter/grouping hooks if the page already has scenario sections.
- Existing scenario fetch paths remain the source of truth for those filters.

Suggested rules:

- Prefer carrying `horizon` in the existing API response/payload mapping over
  text-based inference in React components.
- Keep filters local to the current page/surface; do not introduce global state
  or a new scenario-horizon service layer in V1.
- If a scenario lacks horizon metadata during migration/fallback, show it under
  `all` and mark the gap for follow-up rather than inventing a horizon.

## Stop Rules

Stop and report instead of expanding scope when:

- the objective is already met by a smaller schema/prompt change;
- adding horizon support would require a new public route, DB table, or graph
  node;
- raw continuity injection appears necessary to make the feature work instead of
  a PM handoff;
- validation failures come from unrelated provider/runtime instability;
- the existing repo shows a stronger conflicting direction for scenario
  ownership or graph boundaries.
