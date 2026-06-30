# Scenario Planner

## Purpose

Scenario Planner creates a fixed-horizon conditional market map for the current thesis. It does not create trade commands. It maps what would support, challenge, invalidate, or neutralize the thesis across short-term, mid-term, and long-term branches.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/planners/scenario_planner.py`
- Schema: `ScenarioPlan` and `ScenarioItem` in `apps/ai-service/luna_workstation/agents/schemas.py`
- Persistence: `apps/ai-service/luna_workstation/graph/journal_bridge.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Scenario Planner`
- Stage: `scenario_planner`
- Graph config: `fail_open=True`

## Inputs

- `company_of_interest`
- `trade_date` or `analysis_date`
- `investment_plan`
- `final_trade_decision`
- optional `scenario_continuity_handoff` from Portfolio Manager
- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`
- `quant_signal_text` or `signal_text`
- `quant_signal` for current price anchor
- `setup_type`

## What it does

1. Builds template-validation context from reports, investment plan, final PM decision, and signal text.
2. Validates requested `setup_type` against `TemplateRegistry`.
3. If required template coverage is too weak, degrades to `agent_debate`.
4. Builds date-grounding instruction.
5. Renders Portfolio Manager's `scenario_continuity_handoff` as prior-memory guidance when available.
6. Calls structured LLM once per horizon when provider supports structured output:
   - `short_term` with `24-72h`
   - `mid_term` with `1-3w`
   - `long_term` with `1-3m`
7. Normalizes the horizon results into exactly one scenario per horizon.
8. Creates deterministic horizon fallback scenarios when an individual horizon call is missing or unusable.
9. Grounds unsupported calendar dates by replacing invented/unsupported dates with `prior`.
10. Enriches missing `as_of`, `timeframe`, and `source` from source context.
11. Renders the structured plan to markdown.
12. Returns both markdown and JSON plan.
13. If structured output fails completely, falls back to free-text scenario prompt with a `SCENARIO_PLAN_JSON` block.
14. Journal bridge persists scenarios from JSON first, or parses markdown fallback.

## Scenario coverage

Current structured path produces exactly three scenarios:

- one `short_term` tactical branch (`24-72h`)
- one `mid_term` thesis follow-through branch (`1-3w`)
- one `long_term` structural branch (`1-3m`)

Each branch can support, challenge, invalidate, or stay neutral to the thesis via `relation_to_thesis`.

## Scenario fields

Each `ScenarioItem` includes:

- `horizon`
- `timeframe_label`
- `scenario_name`
- `direction`
- `thesis_impact`
- `relation_to_thesis`
- `condition`
- `expected_behavior`
- `evidence`
- `watch_triggers`
- `impact_on_thesis`
- `probability_band`
- `invalidation`
- `risk_factors`
- `suggested_action`
- `as_of`
- `timeframe`
- `source`
- optional `scenario_recommendation`

`scenario_recommendation` is versioned as `scenario_recommendation.v1` when present. It can include action intent, bias, confidence, required conditions, invalidation conditions, hard gates, blocking reasons, risk notes, evidence refs, validity window, evaluation readiness, and evaluation window.

## Template behavior

Allowed setup types include:

- `breakout`
- `range_reversion`
- `funding_squeeze`
- `news_event`
- `macro_event`
- `trend_pullback`
- `liquidity_sweep`
- `agent_debate`

When a non-generic template is valid, the prompt includes required and optional template fields. If too many required fields are missing, output records:

- `requested_setup_type`
- `setup_type` as effective type
- `template_degraded`
- `missing_template_fields`

## Date grounding

Scenario Planner may use analysis date as run anchor, but must not attach a specific calendar date to levels, breakouts, support, resistance, or catalyst unless that date exists in source artifacts. Unsupported date references are replaced by `prior`.

## Guardrails

- Produces conditional market scenarios, not trade commands.
- Scenario title must not be probability.
- Suggested action should be review/watch/reassess style, not imperative exchange order.
- Structured recommendation should prefer wait/consider/review guidance with blockers and gates when actionability is incomplete.
- Uses `guard_untrusted_context` for PM decision, investment plan, and research reports.
- Does not use raw Research Continuity memory; only the PM-authored `scenario_continuity_handoff` is allowed, and it is prior memory only.
- `fail_open=True` means scenario failure should not fail the whole research run.

## Output

- `scenario_plan`: markdown.
- `scenario_plan_json`: structured JSON when available.
- `sender`: `ScenarioPlanner`.
- `setup_type`
- `requested_setup_type`
- `template_degraded`
- `missing_template_fields`

## Downstream consumers

- Journal scenario persistence.
- UI scenario surfaces.
- Scenario Monitor and runtime evaluator.
- Research continuity / later review flows when scenarios are saved.
