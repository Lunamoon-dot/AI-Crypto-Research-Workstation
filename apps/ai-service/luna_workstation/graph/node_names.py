"""Graph node name constants — single source of truth for all node identifiers.

These replace hardcoded strings in ``setup.py``, ``conditional_logic.py``,
``opinions.py``, and ``tooling.py``.
"""

from __future__ import annotations

from enum import Enum


class _StrEnum(str, Enum):
    """Backport of Python 3.11+ StrEnum for 3.10 compatibility."""

    __str__ = str.__str__


# ---------------------------------------------------------------------------
# Node names used as LangGraph node identifiers (workflow.add_node)
# ---------------------------------------------------------------------------


class AnalystNode(_StrEnum):
    """Analyst node names — used in ``GraphSetup.setup_graph()``."""

    MARKET = "Market Analyst"
    SOCIAL = "Social Analyst"
    NEWS = "News Analyst"
    ONCHAIN = "Onchain Analyst"


class DebateNode(_StrEnum):
    """Debate-stage node names."""

    BULL_RESEARCHER = "Bull Researcher"
    BEAR_RESEARCHER = "Bear Researcher"
    RESEARCH_MANAGER = "Research Manager"


class RiskNode(_StrEnum):
    """Risk debate node names."""

    AGGRESSIVE = "Aggressive Analyst"
    CONSERVATIVE = "Conservative Analyst"
    NEUTRAL = "Neutral Analyst"


class PipelineNode(_StrEnum):
    """Non-debate pipeline node names."""

    SETUP_PLANNER = "Setup Planner"
    TRADER = "Setup Planner"
    PORTFOLIO_MANAGER = "Portfolio Manager"
    SCENARIO_PLANNER = "Scenario Planner"


# ---------------------------------------------------------------------------
# Tool category keys — maps analysts to ToolNodes in create_tool_nodes()
# ---------------------------------------------------------------------------


class ToolKey(_StrEnum):
    """Tool category keys for ``create_tool_nodes()``."""

    MARKET = "market"
    SOCIAL = "social"
    NEWS = "news"
    ONCHAIN = "onchain"


# ---------------------------------------------------------------------------
# Report keys — keys in AgentState for analyst outputs
# ---------------------------------------------------------------------------


class ReportKey(_StrEnum):
    """AgentState report keys."""

    MARKET = "market_report"
    SENTIMENT = "sentiment_report"
    NEWS = "news_report"
    FUNDAMENTALS = "fundamentals_report"


# ---------------------------------------------------------------------------
# Opinion source names — used in opinions.py for AgentOpinion labelling
# ---------------------------------------------------------------------------


class OpinionSource(_StrEnum):
    """Agent names used in ``build_agent_opinions()``."""

    MARKET_ANALYST = "Market Analyst"
    SENTIMENT_ANALYST = "Sentiment Analyst"
    NEWS_ANALYST = "News Analyst"
    ONCHAIN_ANALYST = "Onchain Analyst"
    BULL_RESEARCHER = "Bull Researcher"
    BEAR_RESEARCHER = "Contrarian Analyst"
    RESEARCH_MANAGER = "Research Manager"
    SETUP_PLANNER = "Setup Planner"
    TRADER = "Setup Planner"
    RISK_AGGRESSIVE = "Risk Analyst - Aggressive"
    RISK_CONSERVATIVE = "Risk Analyst - Conservative"
    RISK_NEUTRAL = "Risk Analyst - Neutral"
    PORTFOLIO_MANAGER = "Portfolio Manager"
    QUANT_ANALYST = "Quant Analyst"
