"""Tests for graph/conditional_logic.py — debate and risk routing."""

import pytest

from tradingagents.graph.conditional_logic import ConditionalLogic


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _debate_state(bull_history="", bear_history="", history="",
                  current_response="", judge_decision="", count=0):
    return {
        "bull_history": bull_history,
        "bear_history": bear_history,
        "history": history,
        "current_response": current_response,
        "judge_decision": judge_decision,
        "count": count,
    }


def _risk_state(aggressive_history="", conservative_history="",
                neutral_history="", history="", latest_speaker="",
                current_aggressive_response="",
                current_conservative_response="",
                current_neutral_response="",
                judge_decision="", count=0):
    return {
        "aggressive_history": aggressive_history,
        "conservative_history": conservative_history,
        "neutral_history": neutral_history,
        "history": history,
        "latest_speaker": latest_speaker,
        "current_aggressive_response": current_aggressive_response,
        "current_conservative_response": current_conservative_response,
        "current_neutral_response": current_neutral_response,
        "judge_decision": judge_decision,
        "count": count,
    }


def _agent_state(debate_state=None, risk_state=None):
    state = {
        "company_of_interest": "BTC/USDT",
        "market_report": "",
        "news_report": "",
    }
    if debate_state is not None:
        state["investment_debate_state"] = debate_state
    if risk_state is not None:
        state["risk_debate_state"] = risk_state
    return state


# ---------------------------------------------------------------------------
# Debate routing: should_continue_debate
# ---------------------------------------------------------------------------


class TestDebateRouting:
    def test_max_rounds_exceeded_returns_research_manager(self):
        logic = ConditionalLogic(max_debate_rounds=1)
        ds = _debate_state(count=2, current_response="Bull: buy signal confirmed")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) == "Research Manager"

    def test_within_rounds_bull_responds_sends_to_bear(self):
        logic = ConditionalLogic(max_debate_rounds=2)
        ds = _debate_state(count=0, current_response="Bull: buy signal confirmed")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) == "Bear Researcher"

    def test_within_rounds_non_bull_sends_to_bull(self):
        logic = ConditionalLogic(max_debate_rounds=2)
        ds = _debate_state(count=0, current_response="Bear: bearish divergence")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) == "Bull Researcher"

    def test_exactly_at_limit_sends_to_research_manager(self):
        logic = ConditionalLogic(max_debate_rounds=1)
        ds = _debate_state(count=2, current_response="Bull: final comment")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) == "Research Manager"

    def test_below_limit_sends_to_debater(self):
        logic = ConditionalLogic(max_debate_rounds=1)
        ds = _debate_state(count=1, current_response="Bear: caution advised")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) in ("Bull Researcher", "Bear Researcher")

    def test_multiple_rounds_config(self):
        logic = ConditionalLogic(max_debate_rounds=3)
        ds = _debate_state(count=4, current_response="Bull: position is strong")
        state = _agent_state(debate_state=ds)
        assert logic.should_continue_debate(state) == "Bear Researcher"


# ---------------------------------------------------------------------------
# Risk routing: should_continue_risk_analysis
# ---------------------------------------------------------------------------


class TestRiskRouting:
    def test_max_rounds_exceeded_returns_portfolio_manager(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=1)
        rs = _risk_state(count=3, latest_speaker="Aggressive: risk acceptable")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Portfolio Manager"

    def test_aggressive_last_sends_to_conservative(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=2)
        rs = _risk_state(count=0, latest_speaker="Aggressive: risk acceptable")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Conservative Analyst"

    def test_conservative_last_sends_to_neutral(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=2)
        rs = _risk_state(count=1, latest_speaker="Conservative: too risky")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Neutral Analyst"

    def test_neutral_last_sends_to_aggressive(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=2)
        rs = _risk_state(count=2, latest_speaker="Neutral: moderate risk")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Aggressive Analyst"

    def test_unknown_speaker_sends_to_aggressive(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=2)
        rs = _risk_state(count=0, latest_speaker="")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Aggressive Analyst"

    def test_exactly_at_limit_sends_to_pm(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=1)
        rs = _risk_state(count=3, latest_speaker="Aggressive: final")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Portfolio Manager"

    def test_below_limit_cycles_correctly(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=2)
        # Full 3-agent cycle
        rs = _risk_state(count=0, latest_speaker="")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Aggressive Analyst"

        rs = _risk_state(count=1, latest_speaker="Aggressive: go")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Conservative Analyst"

        rs = _risk_state(count=2, latest_speaker="Conservative: cautious")
        state = _agent_state(risk_state=rs)
        assert logic.should_continue_risk_analysis(state) == "Neutral Analyst"

    def test_multi_round_config(self):
        logic = ConditionalLogic(max_risk_discuss_rounds=3)
        rs = _risk_state(count=5, latest_speaker="Conservative: wait")
        state = _agent_state(risk_state=rs)
        # 5 < 3*3=9, still within rounds
        result = logic.should_continue_risk_analysis(state)
        assert result == "Neutral Analyst"
