# TradingAgents/graph/setup.py

from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Send

from tradingagents.agents import *
from tradingagents.agents.utils.agent_states import AgentState

from .analyst_runtime import make_analyst_runner
from .conditional_logic import ConditionalLogic
from .node_names import (
    AnalystNode,
    DebateNode,
    RiskNode,
    PipelineNode,
    ReportKey,
    ToolKey,
)


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
                    AnalystNode.MARKET,
                    create_market_analyst(self.quick_thinking_llm, config=self.config),
                    ToolKey.MARKET,
                    ReportKey.MARKET,
                )
            )
        if "social" in selected_analysts:
            analyst_specs.append(
                (
                    AnalystNode.SOCIAL,
                    create_social_media_analyst(
                        self.quick_thinking_llm, config=self.config
                    ),
                    ToolKey.SOCIAL,
                    ReportKey.SENTIMENT,
                )
            )
        if "news" in selected_analysts:
            analyst_specs.append(
                (
                    AnalystNode.NEWS,
                    create_news_analyst(self.quick_thinking_llm, config=self.config),
                    ToolKey.NEWS,
                    ReportKey.NEWS,
                )
            )
        if "onchain" in selected_analysts:
            analyst_specs.append(
                (
                    AnalystNode.ONCHAIN,
                    create_onchain_analyst(self.quick_thinking_llm, config=self.config),
                    ToolKey.ONCHAIN,
                    ReportKey.FUNDAMENTALS,
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
            workflow.add_edge(name, DebateNode.BULL_RESEARCHER)

        # Debate/risk pipeline
        workflow.add_node(DebateNode.BULL_RESEARCHER, bull_researcher_node)
        workflow.add_node(DebateNode.BEAR_RESEARCHER, bear_researcher_node)
        workflow.add_node(DebateNode.RESEARCH_MANAGER, research_manager_node)
        workflow.add_node(PipelineNode.TRADER, trader_node)
        workflow.add_node(RiskNode.AGGRESSIVE, aggressive_analyst)
        workflow.add_node(RiskNode.NEUTRAL, neutral_analyst)
        workflow.add_node(RiskNode.CONSERVATIVE, conservative_analyst)
        workflow.add_node(PipelineNode.PORTFOLIO_MANAGER, portfolio_manager_node)
        workflow.add_node(PipelineNode.SCENARIO_PLANNER, scenario_planner_node)
        workflow.add_conditional_edges(
            DebateNode.BULL_RESEARCHER,
            self.conditional_logic.should_continue_debate,
            {
                DebateNode.BEAR_RESEARCHER: DebateNode.BEAR_RESEARCHER,
                DebateNode.RESEARCH_MANAGER: DebateNode.RESEARCH_MANAGER,
            },
        )
        workflow.add_conditional_edges(
            DebateNode.BEAR_RESEARCHER,
            self.conditional_logic.should_continue_debate,
            {
                DebateNode.BULL_RESEARCHER: DebateNode.BULL_RESEARCHER,
                DebateNode.RESEARCH_MANAGER: DebateNode.RESEARCH_MANAGER,
            },
        )
        workflow.add_edge(DebateNode.RESEARCH_MANAGER, PipelineNode.TRADER)
        workflow.add_edge(PipelineNode.TRADER, RiskNode.AGGRESSIVE)
        workflow.add_conditional_edges(
            RiskNode.AGGRESSIVE,
            self.conditional_logic.should_continue_risk_analysis,
            {
                RiskNode.CONSERVATIVE: RiskNode.CONSERVATIVE,
                PipelineNode.PORTFOLIO_MANAGER: PipelineNode.PORTFOLIO_MANAGER,
            },
        )
        workflow.add_conditional_edges(
            RiskNode.CONSERVATIVE,
            self.conditional_logic.should_continue_risk_analysis,
            {
                RiskNode.NEUTRAL: RiskNode.NEUTRAL,
                PipelineNode.PORTFOLIO_MANAGER: PipelineNode.PORTFOLIO_MANAGER,
            },
        )
        workflow.add_conditional_edges(
            RiskNode.NEUTRAL,
            self.conditional_logic.should_continue_risk_analysis,
            {
                RiskNode.AGGRESSIVE: RiskNode.AGGRESSIVE,
                PipelineNode.PORTFOLIO_MANAGER: PipelineNode.PORTFOLIO_MANAGER,
            },
        )

        workflow.add_edge(PipelineNode.PORTFOLIO_MANAGER, PipelineNode.SCENARIO_PLANNER)
        workflow.add_edge(PipelineNode.SCENARIO_PLANNER, END)

        return workflow
