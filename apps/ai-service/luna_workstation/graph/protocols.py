"""Typed graph-node contracts used at dynamic LangGraph boundaries."""

from __future__ import annotations

from typing import Any, Protocol, TypedDict


class ResearchGraphState(TypedDict, total=False):
    """Common state keys shared by analyst, debate, planning, and risk nodes."""

    company_of_interest: str
    trade_date: str
    market_type: str
    market_report: str
    sentiment_report: str
    news_report: str
    fundamentals_report: str
    investment_plan: str
    trader_investment_plan: str
    final_trade_decision: str
    final_trade_summary_json: str
    quant_signal: str
    market_context: str
    quant_signal_text: str
    signal_text: str
    setup_type: str
    past_context: str
    messages: list[Any]
    investment_debate_state: dict[str, Any]
    risk_debate_state: dict[str, Any]


class PropagatorLike(Protocol):
    """Shape expected from graph state propagators."""

    def create_initial_state(
        self,
        company_name: str,
        trade_date: str,
        past_context: str = "",
        market_type: str = "perp",
    ) -> dict[str, Any]:
        """Create the initial graph state."""


class GraphNode(Protocol):
    """Callable shape for a LangGraph node."""

    def __call__(self, state: ResearchGraphState) -> ResearchGraphState:
        """Return a partial state update."""
