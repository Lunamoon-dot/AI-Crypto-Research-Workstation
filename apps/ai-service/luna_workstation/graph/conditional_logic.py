# TradingAgents/graph/conditional_logic.py

from luna_workstation.agents.utils.agent_states import AgentState
from .node_names import DebateNode, RiskNode, PipelineNode


class ConditionalLogic:
    """Conditional routing after the analyst stage (debate / risk debates only).

    Historically this class also owned per-analyst ``should_continue_*`` tool-loop
    edges. Those loops now live entirely inside analyst runner nodes, so debate
    and risk remain the only graph-level conditionals wired from :class:`GraphSetup`.
    """

    def __init__(self, max_debate_rounds=1, max_risk_discuss_rounds=1):
        """Initialize with configuration parameters."""
        self.max_debate_rounds = max_debate_rounds
        self.max_risk_discuss_rounds = max_risk_discuss_rounds

    def should_continue_debate(self, state: AgentState) -> str:
        """Determine if debate should continue."""

        if (
            state["investment_debate_state"]["count"] >= 2 * self.max_debate_rounds
        ):  # 3 rounds of back-and-forth between 2 agents
            return DebateNode.RESEARCH_MANAGER
        if state["investment_debate_state"]["current_response"].startswith("Bull"):
            return DebateNode.BEAR_RESEARCHER
        return DebateNode.BULL_RESEARCHER

    def should_continue_risk_analysis(self, state: AgentState) -> str:
        """Determine if risk analysis should continue."""
        if (
            state["risk_debate_state"]["count"] >= 3 * self.max_risk_discuss_rounds
        ):  # 3 rounds of back-and-forth between 3 agents
            return PipelineNode.PORTFOLIO_MANAGER
        if state["risk_debate_state"]["latest_speaker"].startswith("Aggressive"):
            return RiskNode.CONSERVATIVE
        if state["risk_debate_state"]["latest_speaker"].startswith("Conservative"):
            return RiskNode.NEUTRAL
        return RiskNode.AGGRESSIVE
