# TradingAgents/graph/setup.py

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Dict

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Send

from tradingagents.agents import (
    create_aggressive_debator,
    create_bear_researcher,
    create_bull_researcher,
    create_conservative_debator,
    create_market_analyst,
    create_neutral_debator,
    create_news_analyst,
    create_onchain_analyst,
    create_portfolio_manager,
    create_research_manager,
    create_scenario_planner,
    create_setup_planner,
    create_social_media_analyst,
)
from tradingagents.agents.utils.agent_states import AgentState
from tradingagents.agents.utils.agent_utils import create_analyst_opinion_builder

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


DEFAULT_ANALYSTS = ("market", "social", "news", "onchain")


@dataclass(frozen=True)
class AnalystDefinition:
    """Static metadata needed to register an analyst graph node."""

    selection_key: str
    node_name: AnalystNode
    factory: Callable[..., Any]
    tool_key: ToolKey
    report_key: ReportKey
    opinion_key: str
    agent_name: str
    role: str
    source_report_type: str


ANALYST_DEFINITIONS = (
    AnalystDefinition(
        selection_key="market",
        node_name=AnalystNode.MARKET,
        factory=create_market_analyst,
        tool_key=ToolKey.MARKET,
        report_key=ReportKey.MARKET,
        opinion_key="market_opinion",
        agent_name="Market Analyst",
        role="market_analyst",
        source_report_type="market",
    ),
    AnalystDefinition(
        selection_key="social",
        node_name=AnalystNode.SOCIAL,
        factory=create_social_media_analyst,
        tool_key=ToolKey.SOCIAL,
        report_key=ReportKey.SENTIMENT,
        opinion_key="sentiment_opinion",
        agent_name="Sentiment Analyst",
        role="sentiment_analyst",
        source_report_type="sentiment",
    ),
    AnalystDefinition(
        selection_key="news",
        node_name=AnalystNode.NEWS,
        factory=create_news_analyst,
        tool_key=ToolKey.NEWS,
        report_key=ReportKey.NEWS,
        opinion_key="news_opinion",
        agent_name="News Analyst",
        role="news_analyst",
        source_report_type="news",
    ),
    AnalystDefinition(
        selection_key="onchain",
        node_name=AnalystNode.ONCHAIN,
        factory=create_onchain_analyst,
        tool_key=ToolKey.ONCHAIN,
        report_key=ReportKey.FUNDAMENTALS,
        opinion_key="fundamentals_opinion",
        agent_name="Onchain Analyst",
        role="onchain_analyst",
        source_report_type="onchain",
    ),
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
        budget_tracker: Any | None = None,
    ):
        """Initialize with required components."""
        self.quick_thinking_llm = quick_thinking_llm
        self.deep_thinking_llm = deep_thinking_llm
        self.tool_nodes = tool_nodes
        self.conditional_logic = conditional_logic
        self.config: Dict[str, Any] = config or {}
        self.budget_tracker = budget_tracker

    def setup_graph(self, selected_analysts: Sequence[str] | None = None):
        """Set up and compile the agent workflow graph.

        Analysts run in parallel via LangGraph's Send API. Each analyst
        receives the same initial state and writes to its own report key,
        so there are no cross-analyst data dependencies.
        """
        selected: tuple[str, ...]
        if selected_analysts is None:
            selected = DEFAULT_ANALYSTS
        elif isinstance(selected_analysts, str):
            selected = (selected_analysts,)
        else:
            selected = tuple(selected_analysts)
        if len(selected) == 0:
            raise ValueError("Trading Agents Graph Setup Error: no analysts selected!")

        analyst_definitions = [
            definition
            for definition in ANALYST_DEFINITIONS
            if definition.selection_key in selected
        ]
        if not analyst_definitions:
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
        setup_planner_node = create_setup_planner(
            self.quick_thinking_llm, config=self.config
        )

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
        for definition in analyst_definitions:
            node_fn = definition.factory(
                self.quick_thinking_llm,
                config=self.config,
            )
            opinion_fn = create_analyst_opinion_builder(
                llm=self.quick_thinking_llm,
                agent_name=definition.agent_name,
                role=definition.role,
                source_report_type=definition.source_report_type,
            )
            runner = make_analyst_runner(
                node_fn,
                self.tool_nodes[definition.tool_key],
                report_key=definition.report_key,
                opinion_key=definition.opinion_key,
                opinion_builder=opinion_fn,
            )
            workflow.add_node(
                definition.node_name,
                self._budgeted_node(
                    runner,
                    "analyst",
                    analyst_name=definition.selection_key,
                    graph_node=str(definition.node_name),
                ),
            )
            analyst_names.append(definition.node_name)

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
        workflow.add_node(
            DebateNode.BULL_RESEARCHER,
            self._budgeted_node(
                bull_researcher_node,
                "debate",
                graph_node=str(DebateNode.BULL_RESEARCHER),
            ),
        )
        workflow.add_node(
            DebateNode.BEAR_RESEARCHER,
            self._budgeted_node(
                bear_researcher_node,
                "debate",
                graph_node=str(DebateNode.BEAR_RESEARCHER),
            ),
        )
        workflow.add_node(
            DebateNode.RESEARCH_MANAGER,
            self._budgeted_node(
                research_manager_node,
                "research_manager",
                graph_node=str(DebateNode.RESEARCH_MANAGER),
            ),
        )
        workflow.add_node(
            PipelineNode.SETUP_PLANNER,
            self._budgeted_node(
                setup_planner_node,
                "setup_planner",
                graph_node=str(PipelineNode.SETUP_PLANNER),
            ),
        )
        workflow.add_node(
            RiskNode.AGGRESSIVE,
            self._budgeted_node(
                aggressive_analyst,
                "risk_debate",
                graph_node=str(RiskNode.AGGRESSIVE),
            ),
        )
        workflow.add_node(
            RiskNode.NEUTRAL,
            self._budgeted_node(
                neutral_analyst,
                "risk_debate",
                graph_node=str(RiskNode.NEUTRAL),
            ),
        )
        workflow.add_node(
            RiskNode.CONSERVATIVE,
            self._budgeted_node(
                conservative_analyst,
                "risk_debate",
                graph_node=str(RiskNode.CONSERVATIVE),
            ),
        )
        workflow.add_node(
            PipelineNode.PORTFOLIO_MANAGER,
            self._budgeted_node(
                portfolio_manager_node,
                "portfolio_manager",
                graph_node=str(PipelineNode.PORTFOLIO_MANAGER),
            ),
        )
        workflow.add_node(
            PipelineNode.SCENARIO_PLANNER,
            self._budgeted_node(
                scenario_planner_node,
                "scenario_planner",
                graph_node=str(PipelineNode.SCENARIO_PLANNER),
            ),
        )
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
        workflow.add_edge(DebateNode.RESEARCH_MANAGER, PipelineNode.SETUP_PLANNER)
        workflow.add_edge(PipelineNode.SETUP_PLANNER, RiskNode.AGGRESSIVE)
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

    def _budgeted_node(self, node_fn: Callable[[dict], dict], stage: str, **ctx):
        tracker = self.budget_tracker
        if tracker is None:
            return node_fn

        def _run(state: dict) -> dict:
            with tracker.stage(stage, **ctx):
                return node_fn(state)

        return _run
