# TradingAgents/graph/setup.py

from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from tradingagents.agents import *
from tradingagents.agents.utils.agent_states import AgentState

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

        Analysts run SEQUENTIALLY, each with its own tool loop.  The graph
        unconditionally provides full analyst coverage; tool loops gate
        on whether the last message contains ``tool_calls``.
        """
        if len(selected_analysts) == 0:
            raise ValueError(
                "Trading Agents Graph Setup Error: no analysts selected!"
            )

        # -- Analyst nodes ----------------------------------------------------
        analyst_order = []
        if "market" in selected_analysts:
            analyst_order.append(
                ("Market Analyst", create_market_analyst(
                    self.quick_thinking_llm, config=self.config
                ), "tools_market", "should_continue_market")
            )
        if "social" in selected_analysts:
            analyst_order.append(
                ("Social Analyst", create_social_media_analyst(
                    self.quick_thinking_llm, config=self.config
                ), "tools_social", "should_continue_social")
            )
        if "news" in selected_analysts:
            analyst_order.append(
                ("News Analyst", create_news_analyst(
                    self.quick_thinking_llm, config=self.config
                ), "tools_news", "should_continue_news")
            )
        if "onchain" in selected_analysts:
            analyst_order.append(
                ("Onchain Analyst", create_onchain_analyst(
                    self.quick_thinking_llm, config=self.config
                ), "tools_onchain", "should_continue_onchain")
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

        # Add analyst nodes + tool nodes with sequential edges
        for node_name, node_fn, tools_name, cond_method in analyst_order:
            workflow.add_node(node_name, node_fn)
            workflow.add_node(tools_name, self.tool_nodes[tools_name.split("_", 1)[1]])

        # Sequential analyst pipeline with tool loops
        for i, (node_name, _, tools_name, cond_method) in enumerate(analyst_order):
            # Determine next node after this analyst finishes
            if i + 1 < len(analyst_order):
                next_analyst = analyst_order[i + 1][0]
            else:
                next_analyst = "Bull Researcher"

            conditional = getattr(self.conditional_logic, cond_method)
            workflow.add_conditional_edges(
                node_name,
                conditional,
                {tools_name: tools_name, next_analyst: next_analyst},
            )
            workflow.add_edge(tools_name, node_name)

        # Start with the first analyst
        workflow.add_edge(START, analyst_order[0][0])

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
