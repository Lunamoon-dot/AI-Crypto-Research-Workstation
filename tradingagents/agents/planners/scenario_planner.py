"""Scenario planner: template-guided structured scenarios for thesis planning."""

from __future__ import annotations

import functools
import logging

from langchain_core.messages import AIMessage

from tradingagents.agents.schemas import ScenarioPlan, render_scenario_plan
from tradingagents.agents.utils.agent_utils import build_instrument_context
from tradingagents.agents.utils.structured import bind_structured
from tradingagents.templates.registry import TemplateRegistry

logger = logging.getLogger(__name__)

_TEMPLATE_LINE = (
    "setup_type must be one of: breakout, range_reversion, funding_squeeze, "
    "news_event, macro_event, trend_pullback, liquidity_sweep, or agent_debate."
)

def _template_field_instructions(setup_type: str | None) -> str:
    """Build prompt instructions for template required/optional fields."""
    if not setup_type:
        return ""
    template = TemplateRegistry.get(setup_type)
    if template is None:
        return ""
    lines = [f"\nWhen setup_type is '{setup_type}', you MUST include these fields in every scenario:"]
    for field in template.required_fields:
        lines.append(f"  - {field.name}: {field.description}")
    if template.optional_fields:
        lines.append("Optional fields (include when data is available):")
        for field in template.optional_fields:
            lines.append(f"  - {field.name}: {field.description}")
    return "\n".join(lines)

def create_scenario_planner(llm):
    """Create a scenario planner that emits a structured ``ScenarioPlan`` when supported."""

    structured_llm = bind_structured(llm, ScenarioPlan, "ScenarioPlanner")

    def scenario_node(state, name):
        company_name = state["company_of_interest"]
        instrument_context = build_instrument_context(company_name)
        investment_plan = state.get("investment_plan", "")
        pm_decision = state.get("final_trade_decision", "") or ""

        research_reports = {
            k: state.get(k, "")
            for k in (
                "market_report",
                "sentiment_report",
                "news_report",
                "fundamentals_report",
            )
        }

        reports_block = "\n\n".join(
            f"=== {k} ===\n{v}" for k, v in research_reports.items() if v
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Scenario Planning Analyst. Produce conditional market "
                    "scenarios (not trade commands). Each scenario must have concrete "
                    "conditions, invalidation, risk factors, and a suggested user action "
                    "such as review, watch, or stand aside — never imperative buy/sell."
                    f"{_template_field_instructions(state.get('setup_type'))}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Generate a structured scenario map for {company_name}. "
                    f"{instrument_context}\n\n"
                    f"{_TEMPLATE_LINE}\n\n"
                    f"Produce exactly 3–4 scenarios (each with required template fields if setup_type is specified) covering: directional confirmation, "
                    f"invalidation / adverse path, neutral/wait, and (if debate shows conflict) "
                    f"a contradiction branch.\n\n"
                    f"Portfolio Manager decision (truncated):\n{pm_decision[:6000]}\n\n"
                    f"Investment plan:\n{investment_plan}\n\n"
                    f"Research context:\n{reports_block}"
                ),
            },
        ]

        if structured_llm is not None:
            try:
                plan = structured_llm.invoke(messages)
                markdown = render_scenario_plan(plan)
                return {
                    "messages": [AIMessage(content=markdown)],
                    "scenario_plan": markdown,
                    "scenario_plan_json": plan.model_dump_json(),
                    "sender": name,
                }
            except Exception as exc:
                logger.warning(
                    "ScenarioPlanner: structured output failed (%s); using free text",
                    exc,
                )

        fallback_prompt = f"""You are a Scenario Planning Analyst. Generate 2-3 alternative
future market scenarios for {company_name}. {instrument_context}

For each scenario, describe:
- Key market conditions and catalysts
- Probability assessment
- Impact on the investment thesis
- Recommended response (review / watch / reassess — not buy/sell commands)

{_TEMPLATE_LINE}

Base your scenarios on the research reports and investment plan below.

Research Reports:
{reports_block}

Investment Plan:
{investment_plan}
"""
        response = llm.invoke(fallback_prompt)
        content = response.content if hasattr(response, "content") else str(response)
        return {
            "messages": [AIMessage(content=content)],
            "scenario_plan": content,
            "scenario_plan_json": "",
            "sender": name,
        }

    return functools.partial(scenario_node, name="ScenarioPlanner")