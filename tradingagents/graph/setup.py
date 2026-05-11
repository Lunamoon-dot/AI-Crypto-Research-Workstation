# TradingAgents/graph/setup.py

from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Send

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
        config: Dict[str, Any] | None = None,
    ):
        """Initialize with required components."""
        self.quick_thinking_llm = quick_thinking_llm
        self.deep_thinking_llm = deep_thinking_llm
        self.tool_nodes = tool_nodes
        self.conditional_logic = conditional_logic
        self.config: Dict[str, Any] = config or {}

    def setup_graph(self, selected_analysts=["market", "social", "news", "onchain"]):
        """Set up and compile the agent workflow graph.

        Analysts run in parallel via LangGraph's Send API. Each analyst
        receives the same initial state and writes to its own report key,
        so there are no cross-analyst data dependencies.
        """
        if len(selected_analysts) == 0:
            raise ValueError("Trading Agents Graph Setup Error: no analysts selected!")

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
                    create_social_media_analyst(
                        self.quick_thinking_llm, config=self.config
                    ),
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
        conservative_analyst = create_conservative_debator(self.quick_thinking_llm)
        portfolio_manager_node = create_portfolio_manager(
            self.deep_thinking_llm, config=self.config
        )

        scenario_planner_node = create_scenario_planner(self.quick_thinking_llm)

        # -- Build workflow ---------------------------------------------------
        workflow = StateGraph(AgentState)

        # Collect analyst node names for fan-out.
        analyst_names = []

        # Add analyst nodes (each wraps its own internal tool loop).
        for node_name, node_fn, tool_key, report_key in analyst_specs:
            runner = make_analyst_runner(
                node_fn,
                self.tool_nodes[tool_key],
                report_key=report_key,
            )
            workflow.add_node(node_name, runner)
            analyst_names.append(node_name)

        # Fan-out: all analysts run concurrently from START.
        def _fan_out_analysts(state):
            return [Send(name, state) for name in analyst_names]

        workflow.add_conditional_edges(
            START,
            _fan_out_analysts,
            {name: name for name in analyst_names},
        )

        # Every analyst terminates at Bull Researcher.
        for name in analyst_names:
            workflow.add_edge(name, "Bull Researcher")

        # Debate/risk pipeline
        workflow.add_node("Bull Researcher", bull_researcher_node)
        workflow.add_node("Bear Researcher", bear_researcher_node)
        workflow.add_node("Research Manager", research_manager_node)
        workflow.add_node("Trader", trader_node)
        workflow.add_node("Aggressive Analyst", aggressive_analyst)
        workflow.add_node("Neutral Analyst", neutral_analyst)
        workflow.add_node("Conservative Analyst", conservative_analyst)
        workflow.add_node("Portfolio Manager", portfolio_manager_node)
        workflow.add_node("Scenario Planner", scenario_planner_node)
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

        workflow.add_edge("Portfolio Manager", "Scenario Planner")
        workflow.add_edge("Scenario Planner", END)

        return workflow
