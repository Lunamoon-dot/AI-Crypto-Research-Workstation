from tradingagents.domain import AgentStance, ThesisDirection
from tradingagents.graph.opinions import build_agent_opinions, build_research_debate
from tradingagents.graph.planning import build_trade_thesis
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore


def _final_state():
    return {
        "company_of_interest": "BTC/USDT",
        "market_report": "Trend signal is bullish because higher-timeframe support held. Volume data is insufficient.",
        "sentiment_report": "Sentiment is euphoric and crowded, creating downside risk.",
        "news_report": "News flow is positive because ETF demand improved.",
        "fundamentals_report": "Onchain data is unavailable, but exchange liquidity looks stable.",
        "investment_debate_state": {
            "bull_history": "Bull case: trend signal and volume support a breakout.",
            "bear_history": "Bear case: funding is overheated and sentiment is crowded.",
            "judge_decision": "Balanced view with bullish bias but risk remains.",
        },
        "trader_investment_plan": "Watch for confirmation before any manual review.",
        "risk_debate_state": {
            "aggressive_history": "Aggressive risk view supports upside if breakout confirms.",
            "conservative_history": "Conservative risk view warns downside risk if support fails.",
            "neutral_history": "Neutral risk view recommends waiting for clearer confirmation.",
            "judge_decision": "Final risk view: Hold until confirmation. **Rating**: Hold",
        },
        "final_trade_decision": "**Rating**: Buy\n\n**Investment Thesis**: Bullish but crowded.",
        "investment_plan": "Buy if confirmation improves.",
    }


def _quant_result():
    return SignalResult(
        symbol="BTC/USDT",
        timestamp="2026-05-08T00:00:00Z",
        score=SignalScore.BUY,
        confidence=0.8,
        factors=[
            FactorSignal(
                name="trend",
                score=SignalScore.BUY,
                confidence=0.8,
                value=1.0,
                threshold_breached=True,
                data_quality=0.9,
                detail="Trend is bullish.",
            ),
            FactorSignal(
                name="funding",
                score=SignalScore.SELL,
                confidence=0.7,
                value=0.1,
                threshold_breached=True,
                data_quality=0.2,
                detail="Funding is overheated.",
            ),
        ],
        summary="Composite signal is bullish but funding is crowded.",
    )


def test_phase4_opinion_roles_consensus_and_contradictions():
    opinions = build_agent_opinions(
        _final_state(),
        research_run_id="run_1",
        quant_signal_result=_quant_result(),
    )
    for idx, opinion in enumerate(opinions):
        opinion.id = f"opinion_{idx}"
    debate = build_research_debate(
        symbol="BTC/USDT",
        research_run_id="run_1",
        opinions=opinions,
    )

    names = {opinion.agent_name for opinion in opinions}
    roles = {opinion.role for opinion in opinions}

    assert {"News Analyst", "Sentiment Analyst", "Onchain Analyst", "Quant Analyst"}.issubset(names)
    assert "contrarian" in roles
    assert "risk_analyst" in roles
    assert debate.conflict_level.value in {"medium", "high"}
    assert debate.consensus_confidence < 0.8
    assert any(item.startswith("trend_vs_funding") for item in debate.contradictions)
    assert any("insufficient" in item.lower() or "unavailable" in item.lower() for item in debate.missing_data)


def test_phase4_trade_thesis_contains_opinion_evidence():
    opinions = build_agent_opinions(
        _final_state(),
        research_run_id="run_1",
        quant_signal_result=_quant_result(),
    )
    for idx, opinion in enumerate(opinions):
        opinion.id = f"opinion_{idx}"
    debate = build_research_debate(
        symbol="BTC/USDT",
        research_run_id="run_1",
        opinions=opinions,
    )
    debate.id = "debate_1"

    thesis = build_trade_thesis(
        _final_state(),
        process_signal=lambda _: "Buy",
        quant_signal_result=_quant_result(),
        current_research_run=None,
        current_signals=[],
        current_agent_opinions=opinions,
        current_debate=debate,
        ticker="BTC/USDT",
    )

    assert thesis.direction == ThesisDirection.LONG
    assert thesis.debate_id == "debate_1"
    assert thesis.evidence["supporting_opinion_ids"]
    assert thesis.evidence["contradicting_opinion_ids"]
    assert thesis.evidence["missing_data"]
    assert thesis.evidence["confidence_adjustment_reason"].startswith("Consensus confidence adjusted")
