"""Scenario planner: template-guided structured scenarios for thesis planning.

Phase 5 enforcement: validates template required fields before calling the
LLM.  When critical fields are missing the planner degrades to the generic
``agent_debate`` template and emits a clear warning.
"""

from __future__ import annotations

import functools
import logging

from langchain_core.messages import AIMessage

from luna_workstation.agents.schemas import ScenarioPlan, render_scenario_plan
from luna_workstation.agents.utils.agent_utils import (
    build_instrument_context,
    guard_untrusted_context,
)
from luna_workstation.agents.utils.structured import bind_structured
from luna_workstation.templates.registry import TemplateRegistry

logger = logging.getLogger(__name__)

_TEMPLATE_LINE = (
    "setup_type must be one of: breakout, range_reversion, funding_squeeze, "
    "news_event, macro_event, trend_pullback, liquidity_sweep, or agent_debate."
)


def _build_template_context(state: dict) -> dict[str, str]:
    """Collect context values from state for template field validation.

    Gathers evidence from research reports, investment plan, PM decision,
    and any quant signal data available in the state.
    """
    ctx: dict[str, str] = {}
    # Research reports as context keys
    for key in (
        "market_report",
        "sentiment_report",
        "news_report",
        "fundamentals_report",
    ):
        val = state.get(key, "")
        if val:
            ctx[key] = str(val)[:2000]
    # Investment plan and PM decision
    for key in ("investment_plan", "final_trade_decision"):
        val = state.get(key, "")
        if val:
            ctx[key] = str(val)[:2000]
    # Any pre-computed signal data
    signal_text = state.get("quant_signal_text", "") or state.get("signal_text", "")
    if signal_text:
        ctx["quant_signal"] = str(signal_text)[:2000]
    return ctx


def _template_field_instructions(
    setup_type: str | None,
    *,
    validation_result: dict | None = None,
) -> str:
    """Build prompt instructions for template required/optional fields.

    When *validation_result* carries a degradation, the instructions
    include a clear warning and switch to agent_debate guidance.
    """
    effective = (
        validation_result.get("effective_setup_type", setup_type)
        if validation_result
        else setup_type
    )
    if not effective or effective == "agent_debate":
        if validation_result and validation_result.get("is_degraded"):
            return (
                f"\n[WARNING] Template '{setup_type}' was requested but required fields "
                f"are missing: {', '.join(validation_result.get('missing_fields', []))}. "
                f"Using generic agent_debate template instead. "
                f"Do NOT invent values for missing fields; use the available context only."
            )
        return ""

    template = TemplateRegistry.get(effective)
    if template is None:
        return ""

    lines = [
        f"\nWhen setup_type is '{effective}', you MUST include these fields in every scenario:"
    ]
    for field in template.required_fields:
        lines.append(f"  - {field.name}: {field.description}")
    if template.optional_fields:
        lines.append("Optional fields (include when data is available):")
        for field in template.optional_fields:
            lines.append(f"  - {field.name}: {field.description}")

    # If some required fields are missing, warn but don't degrade if coverage is sufficient
    if validation_result and validation_result.get("missing_fields"):
        missing = validation_result["missing_fields"]
        lines.append(
            f"\nNote: The following required fields are missing from the context "
            f"and should be derived conservatively: {', '.join(missing)}"
        )

    return "\n".join(lines)


def create_scenario_planner(llm):
    """Create a scenario planner that emits a structured ``ScenarioPlan`` when supported.

    **Phase 5 enforcement**: Before calling the LLM, the planner validates
    that the requested template's required fields are present in the context.
    If too many are missing (< 50% coverage), the planner degrades to the
    generic ``agent_debate`` template and emits a clear warning.
    """

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
            f"=== {k} ===\n{guard_untrusted_context(k, v)}"
            for k, v in research_reports.items()
            if v
        )

        # --- Phase 5: pre-LLM template field validation ---
        requested_setup = state.get("setup_type")
        context_values = _build_template_context(state)
        validation = TemplateRegistry.validate_template_context(
            requested_setup,
            context_values,
            required_coverage_threshold=0.5,
        )
        effective_setup = validation["effective_setup_type"]

        if validation["is_degraded"]:
            logger.warning(
                "ScenarioPlanner: template degraded for '%s': %s",
                requested_setup,
                validation["degrade_reason"],
            )

        field_instructions = _template_field_instructions(
            requested_setup, validation_result=validation
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Scenario Planning Analyst. Produce conditional market "
                    "scenarios (not trade commands). Each scenario must have concrete "
                    "conditions, invalidation, risk factors, and a suggested user action "
                    "such as review, watch, or stand aside — never imperative buy/sell."
                    f"{field_instructions}"
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
                    "Portfolio Manager decision (truncated):\n"
                    f"{guard_untrusted_context('portfolio_manager_decision', pm_decision)}\n\n"
                    f"Investment plan:\n{guard_untrusted_context('investment_plan', investment_plan)}\n\n"
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
                    # Phase 5: persist template enforcement metadata
                    "setup_type": effective_setup,
                    "requested_setup_type": requested_setup,
                    "template_degraded": validation["is_degraded"],
                    "missing_template_fields": validation["missing_fields"],
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
{guard_untrusted_context("research_reports", reports_block)}

Investment Plan:
{guard_untrusted_context("investment_plan", investment_plan)}
"""
        response = llm.invoke(fallback_prompt)
        content = response.content if hasattr(response, "content") else str(response)
        return {
            "messages": [AIMessage(content=content)],
            "scenario_plan": content,
            "scenario_plan_json": "",
            "sender": name,
            # Phase 5: persist template enforcement metadata even in fallback
            "setup_type": effective_setup,
            "requested_setup_type": requested_setup,
            "template_degraded": validation["is_degraded"],
            "missing_template_fields": validation["missing_fields"],
        }

    return functools.partial(scenario_node, name="ScenarioPlanner")
