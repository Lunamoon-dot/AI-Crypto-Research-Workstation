"""Setup Planner: turns the Research Manager's plan into a setup proposal."""

from __future__ import annotations

import functools

from langchain_core.messages import AIMessage

from tradingagents.agents.schemas import (
    MarketType,
    SetupProposal,
    render_setup_proposal,
)
from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    guard_untrusted_context,
)
from tradingagents.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)


def _market_type_from(config: dict | None, state: dict) -> MarketType:
    value = state.get("market_type") or (config or {}).get("market_type") or "spot"
    normalized = str(value).strip().lower()
    if normalized in {"perp", "perpetual", "futures", "future"}:
        return MarketType.PERP
    return MarketType.SPOT


def create_setup_planner(llm, config=None):
    structured_llm = bind_structured(llm, SetupProposal, "Setup Planner")

    def setup_planner_node(state, name):
        company_name = state["company_of_interest"]
        instrument_context = build_instrument_context(company_name)
        investment_plan = state["investment_plan"]
        market_type = _market_type_from(config, state)
        market_guidance = (
            "For spot research, focus on accumulation/DCA or swing setup logic, "
            "capital allocation, liquidity, invalidation, and target zones. "
            "Do not discuss leverage or margin."
            if market_type == MarketType.SPOT
            else "For perpetual futures research, explicitly evaluate funding, "
            "open interest, liquidation risk, leverage cap, stop distance, and "
            "margin risk. If funding/OI/liquidation data is missing, list it in "
            "missing_data instead of overstating confidence."
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You are the Setup Planner in a crypto research workflow. "
                    "Your job is to convert the Research Manager's plan into a "
                    "spot/perp-aware setup proposal for manual review. You do "
                    "not place orders, route execution, or imply automated trading. "
                    "Anchor your reasoning in the analysts' reports and research plan."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Based on a comprehensive analysis by a team of analysts, here is an investment "
                    f"plan tailored for {company_name}. {instrument_context} Market type: "
                    f"{market_type.value}. {market_guidance} This plan incorporates "
                    f"insights from current technical market trends, macroeconomic indicators, and "
                    f"social media sentiment. Use this plan as a foundation for a setup proposal, "
                    "not an execution instruction.\n\nProposed Investment Plan: "
                    f"{guard_untrusted_context('investment_plan', investment_plan)}\n\n"
                    "Return a research setup proposal with market_type, action, reasoning, "
                    "entry_zone, invalidation, target_zones, position_sizing, spot_notes "
                    "or perp_notes, and missing_data where relevant."
                ),
            },
        ]

        setup_plan = invoke_structured_or_freetext(
            structured_llm,
            llm,
            messages,
            render_setup_proposal,
            "Setup Planner",
        )

        return {
            "messages": [AIMessage(content=setup_plan)],
            "trader_investment_plan": setup_plan,
            "sender": name,
            "market_type": market_type.value,
        }

    return functools.partial(setup_planner_node, name="Setup Planner")


def create_trader(llm, config=None):
    """Backward-compatible alias for create_setup_planner."""
    return create_setup_planner(llm, config=config)
