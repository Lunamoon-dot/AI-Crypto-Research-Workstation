# TradingAgents/graph/setup.py

from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Send
from langchain_core.messages import HumanMessage

from tradingagents.agents import *
from tradingagents.agents.utils.agent_states import AgentState
from tradingagents.agents.utils.agent_utils import build_instrument_context

from .conditional_logic import ConditionalLogic


# ---------------------------------------------------------------------------
# Fan-out helpers
# ---------------------------------------------------------------------------

ANALYST_MESSAGE_KEYS = {
    "market": "market_messages",
    "social": "social_messages",
    "news": "news_messages",
    "onchain": "onchain_messages",
}


def _create_initializer_node():
    """Node that runs before fan-out. Initialises per-analyst message scopes."""

    def initializer(state):
        ticker = state["company_of_interest"]
        init_msg = HumanMessage(content=build_instrument_context(ticker))
        return {
            "market_messages": [init_msg],
            "social_messages": [init_msg],
            "news_messages": [init_msg],
            "onchain_messages": [init_msg],
        }

    return initializer


def _create_dispatch_function(selected_analysts):
    """Return a function that dispatches Send objects to each analyst."""

    def dispatch(state) -> list[Send]:
        sends = []
        for at in selected_analysts:
            sends.append(Send(f"{at.capitalize()} Analyst", {}))
        return sends

    return dispatch


def _create_aggregate_node():
    """Pass-through node that collects results from all analyst branches."""

    def aggregate(state):
        return {}

    return aggregate


# ---------------------------------------------------------------------------
# GraphSetup
# ---------------------------------------------------------------------------


class GraphSetup:
    """Handles the setup and configuration of the agent graph."""

    def __init__(
        self,
        quick_thinking_llm: Any,
        deep_thinking_llm: Any,
        tool_nodes: Dict[str, ToolNode],
        conditional_logic: ConditionalLogic,
        config: Dict[str, Any] = None,
    ):
        """Initialize with required components."""
        self.quick_thinking_llm = quick_thinking_llm
        self.deep_thinking_llm = deep_thinking_llm
        self.tool_nodes = tool_nodes
        self.conditional_logic = conditional_logic
        self.config = config or {}

    def setup_graph(
        self, selected_analysts=["market", "social", "news", "onchain"]
    ):
        """Set up and compile the agent workflow graph.

        Analysts run in PARALLEL via LangGraph's ``Send`` API, each with
        its own isolated message scope.  The debate and risk phases remain
        sequential.
        """
        if len(selected_analysts) == 0:
            raise ValueError(
                "Trading Agents Graph Setup Error: no analysts selected!"
            )

        # -- Analyst nodes ----------------------------------------------------
        analyst_nodes = {}
        tool_nodes = {}

        if "market" in selected_analysts:
            analyst_nodes["market"] = create_market_analyst(
                self.quick_thinking_llm, config=self.config
            )
            tool_nodes["market"] = self.tool_nodes["market"]

        if "social" in selected_analysts:
            analyst_nodes["social"] = create_social_media_analyst(
                self.quick_thinking_llm, config=self.config
            )
            tool_nodes["social"] = self.tool_nodes["social"]

        if "news" in selected_analysts:
            analyst_nodes["news"] = create_news_analyst(
                self.quick_thinking_llm, config=self.config
            )
            tool_nodes["news"] = self.tool_nodes["news"]

        if "onchain" in selected_analysts:
            analyst_nodes["onchain"] = create_onchain_analyst(
                self.quick_thinking_llm, config=self.config
            )
            tool_nodes["onchain"] = self.tool_nodes["onchain"]

        # -- Researcher and manager nodes -------------------------------------
        bull_researcher_node = create_bull_researcher(
            self.quick_thinking_llm, config=self.config
        )
        bear_researcher_node = create_bear_researcher(
            self.quick_thinking_llm, config=self.config
        )
        research_manager_node = create_research_manager(self.deep_thinking_llm)
        trader_node = create_trader(self.quick_thinking_llm)

        # -- Risk nodes -------------------------------------------------------
        aggressive_analyst = create_aggressive_debator(self.quick_thinking_llm)
        neutral_analyst = create_neutral_debator(self.quick_thinking_llm)
        conservative_analyst = create_conservative_debator(
            self.quick_thinking_llm
        )
        portfolio_manager_node = create_portfolio_manager(
            self.deep_thinking_llm
        )

        # -- Build workflow ---------------------------------------------------
        workflow = StateGraph(AgentState)

        # Fan-out infrastructure
        workflow.add_node("initializer", _create_initializer_node())
        workflow.add_node("aggregate_analysts", _create_aggregate_node())
        workflow.add_edge(START, "initializer")

        # Add analyst nodes + tool nodes (no Msg Clear nodes anymore)
        for analyst_type in selected_analysts:
            node_name = f"{analyst_type.capitalize()} Analyst"
            tools_name = f"tools_{analyst_type}"

            workflow.add_node(node_name, analyst_nodes[analyst_type])
            workflow.add_node(tools_name, tool_nodes[analyst_type])

            # Per-analyst tool-loop: analyst → tools or aggregate_analysts
            workflow.add_conditional_edges(
                node_name,
                getattr(
                    self.conditional_logic,
                    f"should_continue_{analyst_type}",
                ),
                {
                    tools_name: tools_name,
                    "aggregate_analysts": "aggregate_analysts",
                },
            )
            workflow.add_edge(tools_name, node_name)

        # Fan-out dispatch from initializer
        workflow.add_conditional_edges(
            "initializer",
            _create_dispatch_function(selected_analysts),
        )

        # After all analysts converge → sequential debate/risk pipeline
        workflow.add_node("Bull Researcher", bull_researcher_node)
        workflow.add_node("Bear Researcher", bear_researcher_node)
        workflow.add_node("Research Manager", research_manager_node)
        workflow.add_node("Trader", trader_node)
        workflow.add_node("Aggressive Analyst", aggressive_analyst)
        workflow.add_node("Neutral Analyst", neutral_analyst)
        workflow.add_node("Conservative Analyst", conservative_analyst)
        workflow.add_node("Portfolio Manager", portfolio_manager_node)

        workflow.add_edge("aggregate_analysts", "Bull Researcher")

        # Debate edges (unchanged)
        workflow.add_conditional_edges(
            "Bull Researcher",
            self.conditional_logic.should_continue_debate,
            {
                "Bear Researcher": "Bear Researcher",
                "Research Manager": "Research Manager",
            },
        )
        workflow.add_conditional_edges(
            "Bear Researcher",
            self.conditional_logic.should_continue_debate,
            {
                "Bull Researcher": "Bull Researcher",
                "Research Manager": "Research Manager",
            },
        )
        workflow.add_edge("Research Manager", "Trader")
        workflow.add_edge("Trader", "Aggressive Analyst")
        workflow.add_conditional_edges(
            "Aggressive Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Conservative Analyst": "Conservative Analyst",
                "Portfolio Manager": "Portfolio Manager",
            },
        )
        workflow.add_conditional_edges(
            "Conservative Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Neutral Analyst": "Neutral Analyst",
                "Portfolio Manager": "Portfolio Manager",
            },
        )
        workflow.add_conditional_edges(
            "Neutral Analyst",
            self.conditional_logic.should_continue_risk_analysis,
            {
                "Aggressive Analyst": "Aggressive Analyst",
                "Portfolio Manager": "Portfolio Manager",
            },
        )

        workflow.add_edge("Portfolio Manager", END)

        return workflow
