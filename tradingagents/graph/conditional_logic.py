# TradingAgents/graph/conditional_logic.py

from tradingagents.agents.utils.agent_states import AgentState


class ConditionalLogic:
    """Handles conditional logic for determining graph flow.

    Analyst tool loops are now handled inside dedicated analyst runner nodes.
    The remaining conditional methods are used by debate and risk stages.
    """

    def __init__(self, max_debate_rounds=1, max_risk_discuss_rounds=1):
        """Initialize with configuration parameters."""
        self.max_debate_rounds = max_debate_rounds
        self.max_risk_discuss_rounds = max_risk_discuss_rounds

    @staticmethod
    def _get_last_message(state):
        messages = state.get("messages", [])
        return messages[-1] if messages else None

    def should_continue_market(self, state):
        """Determine if market analysis should continue."""
        last = self._get_last_message(state)
        if last is None:
            return "Social Analyst"
        if getattr(last, "tool_calls", None):
            return "tools_market"
        return "Social Analyst"

    def should_continue_social(self, state):
        """Determine if social media analysis should continue."""
        last = self._get_last_message(state)
        if last is None:
            return "News Analyst"
        if getattr(last, "tool_calls", None):
            return "tools_social"
        return "News Analyst"

    def should_continue_news(self, state):
        """Determine if news analysis should continue."""
        last = self._get_last_message(state)
        if last is None:
            return "Onchain Analyst"
        if getattr(last, "tool_calls", None):
            return "tools_news"
        return "Onchain Analyst"

    def should_continue_fundamentals(self, state):
        """Determine if fundamentals analysis should continue."""
        last = self._get_last_message(state)
        if last is None:
            return "Bull Researcher"
        if getattr(last, "tool_calls", None):
            return "tools_fundamentals"
        return "Bull Researcher"

    def should_continue_onchain(self, state):
        """Determine if on-chain analysis should continue."""
        last = self._get_last_message(state)
        if last is None:
            return "Bull Researcher"
        if getattr(last, "tool_calls", None):
            return "tools_onchain"
        return "Bull Researcher"

    def should_continue_debate(self, state: AgentState) -> str:
        """Determine if debate should continue."""

        if (
            state["investment_debate_state"]["count"]
            >= 2 * self.max_debate_rounds
        ):  # 3 rounds of back-and-forth between 2 agents
            return "Research Manager"
        if state["investment_debate_state"]["current_response"].startswith(
            "Bull"
        ):
            return "Bear Researcher"
        return "Bull Researcher"

    def should_continue_risk_analysis(self, state: AgentState) -> str:
        """Determine if risk analysis should continue."""
        if (
            state["risk_debate_state"]["count"]
            >= 3 * self.max_risk_discuss_rounds
        ):  # 3 rounds of back-and-forth between 3 agents
            return "Portfolio Manager"
        if state["risk_debate_state"]["latest_speaker"].startswith(
            "Aggressive"
        ):
            return "Conservative Analyst"
        if state["risk_debate_state"]["latest_speaker"].startswith(
            "Conservative"
        ):
            return "Neutral Analyst"
        return "Aggressive Analyst"
