# Scenario Decision System

Last updated: 2026-06-29
Status: draft master spec

## Purpose

Scenario Decision System is the long-term product endpoint for LunaCrypto's
scenario work.

The system should turn a scenario from a one-off research paragraph into a
durable operational object with a lifecycle:

```text
generate -> normalize -> recommend -> monitor -> gate -> evaluate -> learn
```

The operator should be able to open a thesis, scenario monitor, or workbench and
answer:

```text
Which scenario is active?
Which horizon does it belong to?
How does it relate to the current thesis?
What does the system recommend right now?
What must be true before action is allowed?
What blocks action today?
What invalidates the scenario?
When should this recommendation be evaluated?
Did similar recommendations work before?
```

The system must not become a broker integration, automated order router, or
unbounded free-text advisory layer. Every strong recommendation must be backed
by structured gates, evidence, invalidation, and later evaluation.

## Product Endpoint

The final product endpoint is not a single HTTP endpoint. It is the completed
feature state where scenario decisions behave as first-class research objects.

At the product endpoint, each scenario has:

```text
identity
horizon
relation_to_thesis
recommendation
runtime_decision
evaluation_plan
evaluation_result
reliability_context
optional_playbook
```

At the product endpoint, the user sees:

- Scenario branches grouped by short, mid, and long horizon.
- Clear support, challenge, invalidate, or neutral relation to the current
  thesis.
- Current recommendation state: wait, review, consider long, consider short,
  avoid, reduce, exit, or entry-now only after explicit gates pass.
- Blocking reasons and missing data instead of hidden confidence.
- Required conditions and hard gates before any strong action.
- Evaluation status after the horizon matures.
- Historical reliability by asset, horizon, setup type, and recommendation type.
- A manual playbook only when the scenario is structured enough to simulate.

## Product Boundary

```text
Scenario Horizon Planner
  Generates short, mid, and long scenario branches.

Scenario Recommendation
  Turns each branch into cautious operational guidance.

Scenario Runtime Evaluator
  Recomputes current action from market data and gates.

Scenario Evaluation
  Judges whether the recommendation worked after market time passes.

Scenario Memory
  Aggregates outcomes into reliability priors.

Trade Playbook
  Compiles sufficiently structured recommendations into manual plans.

Backtest Lab
  Simulates executable playbooks, not free-text scenarios.
```

The system must keep these boundaries:

- Scenario generation is not thesis correctness evaluation.
- Recommendation is not broker execution.
- Runtime decision is not a model hallucination surface.
- Evaluation is not broker-accurate PnL unless a later backtest version adds
  fill, fee, slippage, and sizing.
- Continuity is the memory substrate, not a raw prompt injection layer.
- Backtest Lab should only consume structured playbooks, not arbitrary scenario
  prose.

## Existing Foundations

The following pieces already exist or are being added in the current branch.
They should be reused instead of replaced.

### Existing Scenario Generation

Source:

```text
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
apps/ai-service/luna_workstation/agents/schemas.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
apps/ai-service/luna_workstation/domain/scenario.py
```

Current capability:

- Scenario Planner can create scenario branches.
- Horizon-aware output can represent short, mid, and long branches.
- Structured scenario fields already include name, direction, condition,
  expected behavior, probability, invalidation, evidence, watch triggers, and
  horizon metadata.
- Journal bridge can persist scenario payloads.

Use this for:

- Scenario identity.
- Horizon identity.
- Initial evidence and watch triggers.
- Optional AI-authored recommendation intent.

Do not use this for:

- Final evaluation outcome.
- Broker execution action.
- Empirical reliability scoring.

### Existing Thesis Relationship

Source:

```text
apps/ai-service/luna_workstation/agents/schemas.py
apps/api/src/contracts/frontend-contract.ts
apps/web/src/pages/ThesisDetailPage.tsx
```

Current capability:

- Scenarios can carry relation to thesis.
- Expected relation values are support, challenge, invalidate, and neutral.
- UI can signal why an opposite scenario is valid as a stress-test branch.

Use this for:

- Tying every scenario to the current thesis.
- Separating thesis-supporting and thesis-breaking branches.
- Avoiding the feeling that scenario branches are random or unrelated.

### Existing Runtime Decision Layer

Source:

```text
apps/api/src/scenarios/scenario-decision.types.ts
apps/api/src/scenarios/scenario-runtime-evaluator.ts
apps/api/src/scenarios/scenario-evaluator.ts
apps/api/src/scenarios/scenarios.service.ts
apps/api/src/workbench/workbench.service.ts
```

Current capability:

- Runtime decision can evaluate trigger status against current market snapshot.
- Runtime decision can block or downgrade action when data is stale, missing,
  expired, invalidated, overextended, low-confidence, neutral, or blocked by
  hard gates.
- Scenario monitor and workbench can use runtime decision for urgency.

Use this for:

- Deterministic current action.
- Safety gates.
- Avoiding optimistic action when the recommendation is incomplete.

Do not use this for:

- Historical fill simulation.
- Long-run empirical calibration.
- LLM-authored reasoning.

### Existing Read Surfaces

Source:

```text
GET /scenarios/monitor
GET /theses/:id/scenarios
GET /research-runs/:id/workspace
GET /workbench/attention
```

Current capability:

- Scenario Monitor can list active monitored scenarios.
- Thesis Detail can show scenario branches for one thesis.
- Research Run Workspace can show scenarios produced by a run.
- Workbench Attention can surface scenarios requiring review.

Use this for:

- V1 and V2 UI without adding a new scenario route.
- Backward-compatible scenario contract rollout.
- Operator review.

Only create new routes when:

- Scenario outcomes need independent lifecycle operations.
- Scenario reliability needs aggregate query APIs.
- Playbooks/backtests need their own resource identity.

### Existing Calibration Foundation

Source:

```text
docs/features/calibration-lab/README.md
apps/api/src/calibration
```

Current capability:

- Thesis evaluation exists as a research-quality evaluation workflow.
- Evaluation concepts already distinguish machine evaluation artifacts from
  official outcome reviews.
- Calibration has versioned plans for matured evaluation, background jobs,
  quality layers, and trends.

Use this for:

- Scenario Evaluation semantics.
- Matured-window scheduling ideas.
- Outcome review vocabulary.

Do not directly merge scenario evaluation into thesis evaluation. Scenario
evaluation has different objects, horizons, triggers, and result criteria.

### Existing Research Continuity

Source:

```text
docs/features/research-continuity/README.md
apps/api/src/research-continuity
apps/ai-service/luna_workstation/graph/journal_bridge.py
```

Current capability:

- Continuity tracks research memory across runs.
- Scenario memory can be preserved as part of research context.
- Continuity should remain compact and structured.

Use this for:

- Preserving scenario history.
- Feeding compact reliability lessons into future runs.
- Cross-run context.

Do not use this for:

- Raw latest continuity context injection into Scenario Planner.
- Unbounded prompt memory.
- Replacing explicit scenario evaluation records.

## Missing Foundations

The following capabilities do not exist yet and must be built in later versions.

### Missing Persisted Scenario Evaluation

Required before:

- Reliability scoring.
- Scenario learning loop.
- Trade Playbook confidence.
- Backtest candidate selection.

Needed objects:

```text
scenario_evaluations
scenario_evaluation_runs
scenario_outcome_reviews
```

At minimum, a scenario evaluation must store:

- Scenario id.
- Thesis id.
- Workspace id.
- Symbol and market type.
- Evaluation window.
- Trigger state.
- Invalidation state.
- Start price.
- End price.
- Max favorable excursion.
- Max adverse excursion.
- Result: hit, invalidated, missed, mixed, inconclusive.
- Evidence snapshot used for evaluation.
- Warnings and data quality notes.

### Missing Scenario Scheduler

Required before:

- Automatic matured scenario evaluation.
- Reliable outcome population.
- Workbench reminders for due evaluations.

Scheduler should:

- Find scenario recommendations whose evaluation window has ended.
- Avoid duplicate evaluations.
- Record dry-run previews before write mode.
- Degrade gracefully when market data is missing.
- Preserve audit history.

### Missing Reliability Aggregates

Required before:

- Empirical Memory.
- Better future recommendation priors.
- "This setup usually works/fails" product behavior.

Aggregates should be grouped by:

- Workspace.
- Symbol.
- Market type.
- Horizon.
- Direction.
- Relation to thesis.
- Recommendation action.
- Setup template or setup type.
- Data quality tier.

### Missing Playbook Compiler

Required before:

- Backtest Lab.
- Consistent manual trade plan export.
- Comparing structured scenario recommendations.

Compiler must reject scenarios that lack:

- Trigger.
- Invalidation.
- Evaluation window.
- Direction or action bias.
- Required conditions.
- Market type.
- Evidence references.

### Missing Backtest Engine Semantics

Required before:

- Broker-like performance reporting.
- Fee/slippage simulation.
- Fill assumptions.
- Sizing simulation.
- Equity curves.

Backtest Lab must consume playbooks, not scenario prose.

## Version Roadmap

| Version | Capability | Detailed Plan |
| --- | --- | --- |
| V1 | Scenario Recommendation | [V1 implementation plan](v1/implementation-plan.md) |
| V2 | Scenario Evaluation | [V2 implementation plan](v2/implementation-plan.md) |
| V3 | Scenario Reliability Memory | [V3 implementation plan](v3/implementation-plan.md) |
| V4 | Trade Playbook Compiler | [V4 implementation plan](v4/implementation-plan.md) |
| V5 | Backtest Lab | [V5 implementation plan](v5/implementation-plan.md) |
| V6 | Scenario Decision Workbench | [V6 implementation plan](v6/implementation-plan.md) |

Each version must be independently valuable and testable. Do not skip from V1
directly to V5. Without V2 and V3, Backtest Lab would be disconnected from the
actual scenario lifecycle and would likely become a parallel toy simulator.

## V1: Scenario Recommendation

Status: in progress in `codex/scenario-recommendation-v1`.

Primary spec:

```text
docs/features/scenario-decision-system/v1/README.md
docs/features/scenario-decision-system/v1/implementation-plan.md
```

### Goal

Turn saved scenario branches into structured, cautious recommendations with
runtime gates and evaluation-ready metadata.

### User Outcome

The operator can inspect a scenario and understand:

- What action is recommended right now.
- Why that action is recommended.
- What blocks stronger action.
- Which hard gates must pass.
- What invalidates the branch.
- When the scenario should be evaluated later.

### Existing Inputs

V1 is developed from:

- Scenario Planner output.
- Horizon-aware scenario metadata.
- Thesis relationship metadata.
- Market snapshot.
- Signal snapshot.
- Runtime decision evaluator.
- Scenario Monitor.
- Thesis Detail scenario radar.
- Workbench attention.

### New Capabilities Added

V1 adds or formalizes:

```text
scenario_recommendation.v1
scenario_runtime_decision.v1
scenario_evaluation_snapshot.v1
```

`scenario_recommendation.v1` carries:

- Action.
- Action bias.
- Confidence.
- Summary.
- Thesis link.
- Required conditions.
- Invalidation conditions.
- Wait-for conditions.
- Hard gates.
- Blocking reasons.
- Risk notes.
- Evidence refs.
- Valid-until timestamp.
- Evaluation readiness.
- Evaluation window.

`scenario_runtime_decision.v1` carries:

- Trigger status.
- Validity status.
- Recommended action.
- Confidence after gates.
- Matched conditions.
- Failed conditions.
- Blocking reasons.
- Evidence refs.
- Status reason.
- Distance to trigger.
- Final decision overrides.

`scenario_evaluation_snapshot.v1` carries:

- Readiness.
- Planned evaluation time.
- Expected horizon.
- Pending outcome.
- Notes explaining missing readiness.

### API Surfaces

V1 should use existing read surfaces:

```text
GET /scenarios/monitor
GET /theses/:id/scenarios
GET /research-runs/:id/workspace
GET /workbench/attention
```

No new public scenario recommendation route is required in V1.

### AI-Service Work

AI-service should:

- Allow optional recommendation intent on scenario items.
- Prompt Scenario Planner to produce hard gates and blockers when enough
  structure exists.
- Preserve legacy free-text fallback.
- Persist recommendation payload through journal bridge.

### API Work

API should:

- Normalize recommendation shape into `ScenarioResponse`.
- Prefer top-level scenario fields over stale payload copies.
- Keep legacy scenario payloads rendering safely.
- Derive conservative runtime decisions when recommendation is absent.
- Downgrade blocked cases to wait, avoid, or review.

### Web Work

Web should:

- Show recommendation action in Scenario Monitor.
- Show hard gates and blocking reasons.
- Show evaluation readiness.
- Reuse scenario view-model helpers in Thesis Detail.
- Avoid parsing prose for primary recommendation state.

### Non-Goals

V1 must not implement:

- Persisted final scenario outcomes.
- Backtests.
- Broker orders.
- Alerts that imply auto execution.
- New scenario database table unless required by persistence.
- Playbook compiler.

### Verification

Required checks:

```text
tsc -p apps/api/tsconfig.app.json --noEmit
tsc -p apps/api/tsconfig.app.json
node --test ..\..\dist\apps\api\test\api-contract.test.js
tsc -p apps/web/tsconfig.json --noEmit
node --test --experimental-strip-types --experimental-default-type=module test/scenario-monitor-layout.test.ts test/thesis-detail-layout.test.ts
node scripts/python.cjs -m pytest tests/test_structured_agents.py tests/test_journal_bridge_scenarios.py
node scripts/python.cjs -m compileall luna_workstation
node scripts/python.cjs -m mypy luna_workstation
```

### Definition Of Done

V1 is done when:

- Recommendation appears in API contracts and web types.
- Runtime evaluator blocks unsafe actions.
- Scenario Monitor and Thesis Detail show recommendation state.
- AI-service can emit and persist recommendation intent.
- Legacy scenarios still render.
- Focused API, web, and AI-service tests pass.

### Exit Criteria To V2

Move to V2 only when:

- V1 scenarios consistently include evaluation windows.
- Runtime decisions are stable enough to define outcome rules.
- UI can distinguish recommendation from runtime decision.
- Operators can identify which scenario needs later evaluation.

## V2: Scenario Evaluation

Status: planned.

### Goal

Persist scenario outcomes after their evaluation windows mature.

V2 converts evaluation readiness into actual evaluation records.

### User Outcome

The operator can ask:

```text
This scenario recommended waiting for a reclaim.
The horizon ended.
Did the reclaim happen?
Was invalidation hit first?
Was the scenario useful, wrong, mixed, or inconclusive?
```

### Existing Inputs

V2 is developed from:

- `scenario_recommendation.evaluation_window`.
- `scenario_runtime_decision`.
- Market OHLCV data.
- Latest market snapshots.
- Scenario trigger specs.
- Calibration Lab evaluation vocabulary.
- Research run and thesis identity.

### New Capabilities Needed

V2 must create:

```text
scenario_evaluation.v1
scenario_evaluation_run.v1
scenario_outcome_review.v1
```

Recommended API-facing shape:

```ts
type ScenarioEvaluationResult =
  | 'hit'
  | 'invalidated'
  | 'missed'
  | 'mixed'
  | 'inconclusive';

interface ScenarioEvaluation {
  version: 'scenario_evaluation.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  research_run_id: string | null;
  symbol: string;
  market_type: 'spot' | 'perp';
  horizon: 'short_term' | 'mid_term' | 'long_term' | 'unknown';
  evaluated_at: string;
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
  };
  result: ScenarioEvaluationResult;
  trigger_hit: boolean | null;
  invalidation_hit: boolean | null;
  target_hit: boolean | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  data_quality: 'complete' | 'partial' | 'insufficient';
  warnings: string[];
  evidence: Record<string, unknown>;
}
```

### Persistence Requirements

V2 should add durable storage for scenario evaluations.

Minimum table responsibilities:

```text
scenario_evaluations
  One machine evaluation artifact per scenario and evaluation policy version.

scenario_evaluation_runs
  Rerun/audit attempts for the same scenario evaluation.

scenario_outcome_reviews
  Optional human-reviewed final judgment, if needed.
```

If adding tables is too broad for V2.0, V2.0 may start with one
`scenario_evaluations` table and defer reruns/reviews to V2.1.

### Evaluation Rules

V2 must define deterministic rules before implementation.

Suggested default:

- `hit`: trigger condition occurred and invalidation did not occur first.
- `invalidated`: invalidation occurred before trigger or before useful follow
  through.
- `missed`: neither trigger nor target occurred before window ended.
- `mixed`: trigger occurred but follow-through was weak, reversed quickly, or
  invalidation occurred after trigger.
- `inconclusive`: market data is insufficient or scenario lacks a valid trigger.

The exact rule must store enough evidence for audit.

### API Surfaces

Add only what is needed:

```text
GET /scenarios/:id/evaluations
POST /scenarios/:id/evaluations
GET /scenario-evaluations/:id
```

If no top-level scenario detail route exists yet, prefer:

```text
GET /theses/:id/scenarios
GET /scenarios/monitor
```

for read-through display, and add mutation routes only for evaluation actions.

### Web Surfaces

V2 UI should show:

- Evaluation status on Scenario Monitor.
- Evaluation result on Thesis Detail scenario cards.
- Pending, due, evaluated, inconclusive states.
- Data quality warnings.
- Link from scenario card to evaluation detail or evidence section.

Do not build a full dashboard in V2 unless the basic evaluation loop is stable.

### AI-Service Work

AI-service should not decide final outcome by prose.

AI-service may:

- Provide scenario trigger structure.
- Provide invalidation structure.
- Provide evaluation hints.

API/evaluation engine should:

- Compute outcome from market data.
- Persist evidence.
- Mark insufficient structure explicitly.

### Tests

Minimum tests:

- Scenario with trigger hit before invalidation becomes `hit`.
- Scenario with invalidation before trigger becomes `invalidated`.
- Scenario with no trigger by window end becomes `missed`.
- Missing OHLCV produces `inconclusive` with data warning.
- Re-running the same evaluation is idempotent or creates an audit run according
  to the chosen policy.
- Workspace scoping prevents reading another workspace's evaluations.

### Non-Goals

V2 must not implement:

- Fee/slippage backtesting.
- Position sizing.
- Equity curve.
- Automated order execution.
- Empirical model retraining.

### Definition Of Done

V2 is done when:

- Matured scenario recommendations can be evaluated and persisted.
- Results are visible on existing scenario surfaces.
- Data quality warnings are explicit.
- Evaluation is deterministic and auditable.
- Legacy scenarios without evaluation windows remain safe.

### Exit Criteria To V3

Move to V3 only when:

- Enough scenario evaluations exist to aggregate.
- Evaluation result categories are stable.
- Data quality fields can filter unreliable outcomes.
- Operators can distinguish machine evaluation from human judgment.

## V3: Scenario Reliability Memory

Status: planned.

### Goal

Aggregate scenario evaluation outcomes into compact reliability priors that can
inform future research without becoming raw memory injection.

### User Outcome

The operator can ask:

```text
How reliable are short-term bullish reclaim scenarios for BTC spot?
Does this model over-rate invalidation branches?
Which scenario types produce useful warnings?
Should this new scenario get lower confidence because similar setups failed?
```

### Existing Inputs

V3 is developed from:

- Scenario evaluations from V2.
- Research Continuity.
- Calibration Lab aggregation patterns.
- Scenario horizon metadata.
- Relation-to-thesis metadata.
- Recommendation action and action bias.
- Runtime blocker history.

### New Capabilities Needed

V3 must create:

```text
scenario_reliability_profile.v1
scenario_memory_digest.v1
scenario_reliability_rollup.v1
```

Suggested shape:

```ts
interface ScenarioReliabilityProfile {
  version: 'scenario_reliability_profile.v1';
  workspace_id: string;
  symbol: string | null;
  market_type: 'spot' | 'perp' | 'mixed';
  horizon: string;
  relation_to_thesis: string;
  action_bias: string;
  setup_type: string | null;
  sample_size: number;
  hit_rate: number | null;
  invalidation_rate: number | null;
  mixed_rate: number | null;
  inconclusive_rate: number | null;
  average_mfe: number | null;
  average_mae: number | null;
  data_quality_notes: string[];
  recent_lessons: string[];
  generated_at: string;
}
```

### Aggregation Rules

V3 must avoid false precision.

Rules:

- Do not show hit rate when sample size is below the configured minimum.
- Separate complete and partial data quality.
- Do not aggregate spot and perp unless explicitly requested.
- Do not aggregate unrelated horizons.
- Keep inconclusive outcomes visible instead of dropping them.
- Store generated-at and input evaluation IDs.

### Memory Boundary

Reliability memory should feed future agents as compact lessons:

```text
For BTC spot short-term reclaim scenarios, recent complete evaluations show
low sample size and mixed follow-through. Treat new reclaim branches as watch
only unless volume and close confirmation are present.
```

It must not inject raw evaluation rows or old scenario prose into Scenario
Planner.

Preferred owner:

```text
Portfolio Manager creates or approves compact scenario memory handoff.
Scenario Planner consumes only the compact handoff.
```

### API Surfaces

Likely read endpoints:

```text
GET /scenario-reliability
GET /scenario-reliability/:symbol
GET /theses/:id/scenario-reliability
```

Mutation endpoints should be limited to:

```text
POST /scenario-reliability/rebuild
```

if background rebuild is needed.

### Web Surfaces

V3 UI should show:

- Reliability chips on scenario cards.
- Sample-size warnings.
- "Not enough history" state.
- Recent lessons.
- Filters by symbol, horizon, market type, action bias.

Avoid a large analytics dashboard until the rollups prove useful.

### Tests

Minimum tests:

- Low sample size hides hit rate and shows insufficient sample note.
- Spot and perp do not mix by default.
- Inconclusive outcomes are counted.
- Data-quality filtering changes rollup.
- Compact digest excludes raw old scenario text.
- Future AI-service prompt context receives only compact digest fields.

### Non-Goals

V3 must not implement:

- Backtesting.
- Model retraining.
- Automated confidence overrides without showing reason.
- Global cross-workspace learning unless explicitly designed later.

### Definition Of Done

V3 is done when:

- Scenario evaluations produce reliability rollups.
- Rollups are visible where scenarios are reviewed.
- Compact reliability memory can be fed into future research runs.
- Low-quality or low-sample evidence is clearly labeled.

### Exit Criteria To V4

Move to V4 only when:

- Scenario recommendations have enough structure and evaluation history to
  justify playbook compilation.
- The system can identify which scenario types are worth simulating.
- Reliability notes can become playbook risk context.

## V4: Trade Playbook Compiler

Status: planned.

### Goal

Compile sufficiently structured scenario recommendations into manual trade
playbooks that can later be simulated.

V4 is not a backtest. It is the contract bridge between research scenarios and
simulation-ready plans.

### User Outcome

The operator can ask:

```text
Can this scenario become a manual playbook?
What is the entry trigger?
What invalidates it?
Where are targets?
What sizing context is allowed?
What must make the playbook invalid?
Why was a playbook rejected?
```

### Existing Inputs

V4 is developed from:

- `scenario_recommendation.v1`.
- `scenario_runtime_decision.v1`.
- `scenario_evaluation.v1`.
- Reliability profile from V3.
- Thesis direction and confidence.
- Market type.
- Trigger and invalidation structure.

### New Capabilities Needed

V4 must create:

```text
trade_playbook.v1
playbook_compile_report.v1
playbook_validation_result.v1
```

Suggested shape:

```ts
interface TradePlaybook {
  version: 'trade_playbook.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short' | 'avoid';
  horizon: string;
  entry: {
    type: 'level' | 'zone' | 'condition';
    condition: string;
    level: number | null;
    zone_low: number | null;
    zone_high: number | null;
  };
  invalidation: {
    condition: string;
    level: number | null;
  };
  targets: Array<{
    label: string;
    level: number | null;
    rationale: string;
  }>;
  no_trade_conditions: string[];
  risk_context: string[];
  sizing_policy: {
    mode: 'manual_context_only';
    notes: string[];
  };
  evidence_refs: Array<Record<string, unknown>>;
  reliability_context: Record<string, unknown> | null;
  compile_warnings: string[];
  created_at: string;
}
```

### Compiler Rules

The compiler must be strict.

Reject playbook compilation when:

- Action is wait, review, or avoid without a directional plan.
- Trigger is missing.
- Invalidation is missing.
- Market type is unknown.
- Direction is unknown or neutral.
- Evidence refs are empty.
- Scenario is expired or invalidated.
- Hard gates are pending.
- Current runtime decision has unresolved blockers.

Allow compile with warnings when:

- Targets are textual but no exact level exists.
- Reliability sample is small.
- Data quality is partial.
- Sizing is manual context only.

### API Surfaces

Likely endpoints:

```text
POST /scenarios/:id/playbook
GET /scenarios/:id/playbook
GET /playbooks/:id
```

Do not put playbook creation inside Scenario Monitor read calls.

### Web Surfaces

V4 UI should show:

- "Compile playbook" action only when scenario is eligible.
- Rejection reasons when not eligible.
- Playbook preview with entry, invalidation, targets, no-trade conditions.
- Manual context badge, not auto-execution language.

### Tests

Minimum tests:

- Missing invalidation rejects compile.
- Pending hard gate rejects compile.
- Valid long scenario compiles to playbook.
- Expired scenario rejects compile.
- Playbook is workspace scoped.
- UI hides compile action when ineligible.

### Non-Goals

V4 must not implement:

- Backtest simulation.
- Broker execution.
- Position sizing math beyond manual notes.
- Optimization.

### Definition Of Done

V4 is done when:

- Eligible scenarios can compile into deterministic playbooks.
- Ineligible scenarios produce clear rejection reports.
- Playbooks are persisted and inspectable.
- Backtest Lab has a stable input contract.

### Exit Criteria To V5

Move to V5 only when:

- Playbooks have stable entry, invalidation, target, and market-type fields.
- Compile rejection rates are understood.
- Manual playbooks can be generated from real scenario runs.

## V5: Backtest Lab

Status: planned.

### Goal

Simulate validated trade playbooks with explicit assumptions for fill, fees,
slippage, sizing, and market data quality.

### User Outcome

The operator can ask:

```text
If this playbook had been applied historically under explicit assumptions,
what would have happened?
How sensitive is the result to fees, slippage, and fill policy?
Which playbook types are promising enough for more research?
```

### Existing Inputs

V5 is developed from:

- Trade Playbook V1.
- Historical OHLCV.
- Market data provider layer.
- Scenario evaluation evidence.
- Calibration trend patterns.

### New Capabilities Needed

V5 must create:

```text
backtest_run.v1
backtest_assumption_set.v1
backtest_result.v1
backtest_trade_event.v1
```

Required assumptions:

- Fee model.
- Slippage model.
- Fill model.
- Position sizing model.
- Timeframe.
- Start and end date.
- Market type.
- Data provider.
- Missing data policy.

### Backtest Rules

V5 must not pretend to be broker-accurate without broker data.

Rules:

- Results must always show assumptions.
- Results must show data gaps.
- No result should be displayed without the playbook version.
- Backtest should be reproducible from stored input.
- Backtest should not mutate scenario evaluations.
- Optimization should be deferred.

### API Surfaces

Likely endpoints:

```text
POST /playbooks/:id/backtests
GET /playbooks/:id/backtests
GET /backtests/:id
```

Optional later:

```text
POST /backtests/:id/rerun
```

### Web Surfaces

V5 UI should show:

- Assumptions panel.
- Result summary.
- Trade event list.
- Equity or cumulative return chart only if assumptions are complete.
- Data quality warnings.
- Compare backtests for one playbook.

### Tests

Minimum tests:

- Backtest requires a valid playbook.
- Backtest stores assumption set.
- Fee and slippage change result.
- Missing OHLCV marks result partial or failed.
- Same input can reproduce same result.
- Workspace scoping protects backtest reads.

### Non-Goals

V5 must not implement:

- Live trading.
- Auto optimization.
- Multi-strategy portfolio allocation.
- Cross-exchange execution modeling unless explicitly scoped.

### Definition Of Done

V5 is done when:

- A persisted playbook can run a reproducible backtest.
- Result assumptions are visible.
- Data quality is explicit.
- Results are useful for research comparison, not marketed as trading truth.

### Exit Criteria To V6

Move to V6 only when:

- Operators can evaluate, compile, and backtest without reading raw JSON.
- Common workflows are clear enough to consolidate into one workbench.
- The system has enough artifacts to prioritize decisions.

## V6: Scenario Decision Workbench

Status: planned.

### Goal

Unify scenario monitoring, evaluation, reliability, playbooks, and backtests into
one operator workflow.

### User Outcome

The operator can use one screen to answer:

```text
What scenario needs attention now?
Which scenario is due for evaluation?
Which recommendation was wrong?
Which playbook should be reviewed?
Which backtest result is reliable enough to consider?
What changed since the last research run?
```

### Existing Inputs

V6 is developed from:

- Scenario Monitor.
- Workbench Attention.
- Scenario Evaluation.
- Scenario Reliability Memory.
- Trade Playbook.
- Backtest Lab.
- Research Continuity timeline.

### New Capabilities Needed

V6 should create:

```text
scenario_decision_queue.v1
scenario_decision_workspace.v1
scenario_decision_audit_event.v1
```

### Workbench Sections

Recommended layout:

- Active scenarios.
- Due evaluations.
- Failed or inconclusive evaluations.
- High-priority blockers.
- Reliability lessons.
- Playbook candidates.
- Recent backtests.
- Continuity changes.

### Decision Queue Rules

Queue priority should consider:

- Triggered scenario.
- Near-trigger scenario.
- Hard gate passed.
- Evaluation due.
- Evaluation failed or inconclusive.
- Reliability changed materially.
- Playbook compile eligible.
- Backtest result ready.

### API Surfaces

Likely endpoint:

```text
GET /scenario-decision/workbench
```

Possible actions:

```text
POST /scenario-decision/items/:id/resolve
POST /scenario-decision/items/:id/snooze
```

Keep this separate from `GET /workbench/attention` only if the scenario-specific
workflow becomes too complex for the general workbench.

### Web Surfaces

V6 UI should be operational and dense:

- No landing page.
- Prioritize scan, filter, compare, and repeated review.
- Show exact blockers and next action.
- Keep visual hierarchy compact.
- Avoid hiding data quality warnings.

### Tests

Minimum tests:

- Queue priority orders triggered and due items correctly.
- Resolved items disappear or move to history.
- Snoozed items return after due time.
- Workspace scoping works.
- Workbench handles missing downstream features gracefully.

### Non-Goals

V6 must not implement:

- Auto trading.
- Autonomous portfolio allocation.
- Notification spam.
- Cross-workspace aggregation by default.

### Definition Of Done

V6 is done when:

- Scenario lifecycle objects are visible in one workflow.
- The operator can move from active scenario to evaluation to playbook/backtest.
- Priority and blocking reasons are explicit.
- The system remains auditable.

## Version Dependencies

```text
V1 Scenario Recommendation
  depends on:
    Scenario Planner
    Scenario Horizon Planner
    Runtime Evaluator
    Scenario Monitor
    Thesis Detail

V2 Scenario Evaluation
  depends on:
    V1 evaluation windows
    Market historical data
    Scenario trigger/invalidation structure
    Calibration evaluation patterns

V3 Scenario Reliability Memory
  depends on:
    V2 persisted evaluations
    Research Continuity
    Data quality labels

V4 Trade Playbook Compiler
  depends on:
    V1 structured recommendations
    V2 outcomes
    V3 reliability context

V5 Backtest Lab
  depends on:
    V4 playbooks
    Historical market data
    Explicit assumptions

V6 Scenario Decision Workbench
  depends on:
    V1 monitoring
    V2 evaluations
    V3 reliability
    V4 playbooks
    V5 backtests
```

## Do Not Build Out Of Order

Avoid these shortcuts:

- Do not build Backtest Lab before persisted playbooks exist.
- Do not build reliability percentages before scenario evaluations exist.
- Do not let AI prose decide historical outcome.
- Do not add broker-like UI copy before execution boundaries exist.
- Do not create a new route for every small display need.
- Do not feed raw continuity payloads directly into Scenario Planner.
- Do not hide low sample size or data quality gaps.

## Naming Rules

Use these canonical names:

```text
Scenario Recommendation
Scenario Runtime Decision
Scenario Evaluation
Scenario Reliability Memory
Trade Playbook
Backtest Lab
Scenario Decision Workbench
```

Avoid these ambiguous names:

```text
AI Signal
Auto Trade
Scenario Bot
Trade Executor
Prediction Engine
```

## Contract Version Rules

Each durable shape must carry an explicit version:

```text
scenario_recommendation.v1
scenario_runtime_decision.v1
scenario_evaluation_snapshot.v1
scenario_evaluation.v1
scenario_reliability_profile.v1
trade_playbook.v1
backtest_run.v1
scenario_decision_queue.v1
```

Rules:

- New fields can be additive inside the same version.
- Semantic changes require a new version.
- Legacy payloads must degrade to review, wait, or not-ready states.
- Top-level canonical fields should win over stale nested payload copies.

## Data Quality Policy

Every version must preserve data quality explicitly.

Required labels:

```text
complete
partial
insufficient
stale
missing
inconclusive
```

Do not convert missing data into confidence. Missing data should become a
warning, blocker, or inconclusive outcome.

## Security And Safety Boundary

The system must:

- Stay workspace scoped.
- Avoid leaking cross-workspace reliability data.
- Avoid writing secrets into evaluation evidence.
- Avoid implying automated execution.
- Avoid hiding provider failures.
- Preserve audit records for manual evaluation actions.

## Observability Requirements

Each version should emit enough events to explain the lifecycle:

```text
scenario.recommendation.recorded
scenario.runtime.evaluated
scenario.evaluation.due
scenario.evaluation.completed
scenario.evaluation.inconclusive
scenario.reliability.rebuilt
playbook.compiled
playbook.rejected
backtest.started
backtest.completed
backtest.failed
```

Do not add all events in V1. Add them as each version creates the relevant
resource.

## Testing Strategy

Each version should have:

- Contract normalization tests.
- Legacy payload compatibility tests.
- Workspace scoping tests.
- Data quality tests.
- UI rendering tests for the main operator surface.
- Focused AI-service persistence tests when AI-service output changes.

Use narrow tests first. Run broader suites when shared contracts change.

## Final Product Acceptance

The full Scenario Decision System is complete when:

- A scenario branch can be generated, recommended, monitored, evaluated, learned
  from, compiled, and backtested.
- Every step is visible and auditable.
- Missing data and uncertainty are explicit.
- Strong actions require hard gates.
- Historical reliability influences future research through compact structured
  memory.
- Backtests only operate on structured playbooks with explicit assumptions.
- No feature implies live execution unless a separate execution-system spec is
  written and approved.
