# TradingAgents/graph/setup.py

from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from tradingagents.agents import *
from tradingagents.agents.utils.agent_states import AgentState

from .analyst_runtime import make_analyst_runner
from .conditional_logic import ConditionalLogic


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

        Analysts run in PARALLEL. Each analyst node executes its own local tool
        loop until completion, then all analyst branches join before debate.
        """
        if len(selected_analysts) == 0:
            raise ValueError(
                "Trading Agents Graph Setup Error: no analysts selected!"
            )

        # -- Analyst nodes ----------------------------------------------------
        analyst_specs = []
        if "market" in selected_analysts:
            analyst_specs.append(
                (
                    "Market Analyst",
                    create_market_analyst(self.quick_thinking_llm, config=self.config),
                    "market",
                    "market_report",
                )
            )
        if "social" in selected_analysts:
            analyst_specs.append(
                (
                    "Social Analyst",
                    create_social_media_analyst(self.quick_thinking_llm, config=self.config),
                    "social",
                    "sentiment_report",
                )
            )
        if "news" in selected_analysts:
            analyst_specs.append(
                (
                    "News Analyst",
                    create_news_analyst(self.quick_thinking_llm, config=self.config),
                    "news",
                    "news_report",
                )
            )
        if "onchain" in selected_analysts:
            analyst_specs.append(
                (
                    "Onchain Analyst",
                    create_onchain_analyst(self.quick_thinking_llm, config=self.config),
                    "onchain",
                    "fundamentals_report",
                )
            )
        if not analyst_specs:
            raise ValueError(
                "Trading Agents Graph Setup Error: selected analysts are invalid!"
            )

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

        # Add analyst nodes (each wraps its own internal tool loop).
        for node_name, node_fn, tool_key, report_key in analyst_specs:
            runner = make_analyst_runner(
                node_fn,
                self.tool_nodes[tool_key],
                report_key=report_key,
            )
            workflow.add_node(node_name, runner)

        # Fan-out from START: run all selected analysts concurrently.
        for node_name, _, _, _ in analyst_specs:
            workflow.add_edge(START, node_name)

        # Fan-in barrier: wait until all analyst branches complete.
        workflow.add_node("Analyst Barrier", lambda _state: {})
        for node_name, _, _, _ in analyst_specs:
            workflow.add_edge(node_name, "Analyst Barrier")

        # After last analyst → debate/risk pipeline
        workflow.add_node("Bull Researcher", bull_researcher_node)
        workflow.add_node("Bear Researcher", bear_researcher_node)
        workflow.add_node("Research Manager", research_manager_node)
        workflow.add_node("Trader", trader_node)
        workflow.add_node("Aggressive Analyst", aggressive_analyst)
        workflow.add_node("Neutral Analyst", neutral_analyst)
        workflow.add_node("Conservative Analyst", conservative_analyst)
        workflow.add_node("Portfolio Manager", portfolio_manager_node)

        # Debate edges
        workflow.add_edge("Analyst Barrier", "Bull Researcher")
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
