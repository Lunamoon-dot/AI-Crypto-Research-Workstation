# TradingAgents/graph/conditional_logic.py

from tradingagents.agents.utils.agent_states import AgentState


# Per-analyst message scope keys — mirrors ANALYST_MESSAGE_KEYS in setup.py
_MESSAGE_SCOPES = {
    "market": "market_messages",
    "social": "social_messages",
    "news": "news_messages",
    "onchain": "onchain_messages",
    "fundamentals": "onchain_messages",  # legacy alias
}


class ConditionalLogic:
    """Handles conditional logic for determining graph flow.

    With parallel analyst fan-out, each ``should_continue_*`` method reads
    from the analyst's own message scope instead of the shared ``messages``.
    """

    def __init__(self, max_debate_rounds=1, max_risk_discuss_rounds=1):
        """Initialize with configuration parameters."""
        self.max_debate_rounds = max_debate_rounds
        self.max_risk_discuss_rounds = max_risk_discuss_rounds

    def _get_messages(self, state: AgentState, analyst_key: str):
        """Return the appropriate message list for *analyst_key*."""
        scope_key = _MESSAGE_SCOPES.get(analyst_key, "messages")
        messages = state.get(scope_key, state.get("messages", []))
        return messages

    def should_continue_market(self, state: AgentState):
        """Determine if market analysis should continue."""
        messages = self._get_messages(state, "market")
        if not messages:
            return "aggregate_analysts"
        last_message = messages[-1]
        if getattr(last_message, "tool_calls", None):
            return "tools_market"
        return "aggregate_analysts"

    def should_continue_social(self, state: AgentState):
        """Determine if social media analysis should continue."""
        messages = self._get_messages(state, "social")
        if not messages:
            return "aggregate_analysts"
        last_message = messages[-1]
        if getattr(last_message, "tool_calls", None):
            return "tools_social"
        return "aggregate_analysts"

    def should_continue_news(self, state: AgentState):
        """Determine if news analysis should continue."""
        messages = self._get_messages(state, "news")
        if not messages:
            return "aggregate_analysts"
        last_message = messages[-1]
        if getattr(last_message, "tool_calls", None):
            return "tools_news"
        return "aggregate_analysts"

    def should_continue_fundamentals(self, state: AgentState):
        """Determine if fundamentals analysis should continue."""
        messages = self._get_messages(state, "fundamentals")
        if not messages:
            return "aggregate_analysts"
        last_message = messages[-1]
        if getattr(last_message, "tool_calls", None):
            return "tools_fundamentals"
        return "aggregate_analysts"

    def should_continue_onchain(self, state: AgentState):
        """Determine if on-chain analysis should continue (crypto mode)."""
        messages = self._get_messages(state, "onchain")
        if not messages:
            return "aggregate_analysts"
        last_message = messages[-1]
        if getattr(last_message, "tool_calls", None):
            return "tools_onchain"
        return "aggregate_analysts"

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
