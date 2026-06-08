# Scenario Planner

## Purpose

Scenario Planner creates conditional market scenarios for the current thesis. It does not create trade commands. It maps what would confirm, invalidate, neutralize, or contradict the thesis.

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
- `market_report`
- `sentiment_report`
- `news_report`
- `fundamentals_report`
- `quant_signal_text` or `signal_text`
- `setup_type`

## What it does

1. Builds template-validation context from reports, investment plan, final PM decision, and signal text.
2. Validates requested `setup_type` against `TemplateRegistry`.
3. If required template coverage is too weak, degrades to `agent_debate`.
4. Builds date-grounding instruction.
5. Calls structured LLM for `ScenarioPlan` when provider supports structured output.
6. Grounds unsupported calendar dates by replacing invented/unsupported dates with `prior`.
7. Renders the structured plan to markdown.
8. Returns both markdown and JSON plan.
9. If structured output fails, falls back to free-text scenario prompt.
10. Journal bridge persists scenarios from JSON first, or parses markdown fallback.

## Scenario coverage

Prompt asks for exactly 3-4 scenarios covering:

- directional confirmation
- invalidation / adverse path
- neutral / wait
- contradiction branch when debate shows conflict

The post-processing caps structured scenario count to 4.

## Scenario fields

Each `ScenarioItem` includes:

- `scenario_name`
- `direction`
- `thesis_impact`
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
- Uses `guard_untrusted_context` for PM decision, investment plan, and research reports.
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
- Research continuity / later review flows when scenarios are saved.
