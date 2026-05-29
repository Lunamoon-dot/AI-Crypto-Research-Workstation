from luna_workstation.domain import (
    AgentStance,
    ConflictLevel,
    DataFreshness,
    ResearchDebate,
    ScenarioProbabilityBand,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
    TradeThesis,
)
from luna_workstation.graph.scenarios import build_scenarios_for_thesis


def test_build_scenarios_for_long_thesis_with_conflict():
    thesis = TradeThesis(
        id="thesis_1",
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if resistance reclaim holds.",
        confidence=0.72,
        invalidation_level="Lose 103800",
        risk_notes=["Manual review required."],
        contradictions=["Funding is elevated."],
    )
    debate = ResearchDebate(
        research_run_id="run_1",
        symbol="BTC/USDT",
        consensus_stance=AgentStance.BULLISH,
        conflict_level=ConflictLevel.HIGH,
        contradictions=["Trend is bullish but funding is crowded."],
    )
    signals = [
        Signal(
            symbol="BTC/USDT",
            signal_type="trend",
            direction=SignalDirection.BULLISH,
            summary="Higher-timeframe trend is intact.",
            provenance=SignalProvenance(source="test", freshness=DataFreshness.FRESH),
        ),
        Signal(
            symbol="BTC/USDT",
            signal_type="funding",
            direction=SignalDirection.BEARISH,
            summary="Funding is elevated.",
            provenance=SignalProvenance(source="test", freshness=DataFreshness.STALE),
        ),
    ]

    scenarios = build_scenarios_for_thesis(thesis, debate=debate, signals=signals)

    assert len(scenarios) == 4
    assert all(scenario.thesis_id == thesis.id for scenario in scenarios)
    assert scenarios[0].probability_band == ScenarioProbabilityBand.MEDIUM
    assert any("Funding is elevated" in scenario.condition for scenario in scenarios)
    assert any(
        scenario.suggested_user_action == "reduce confidence and review evidence"
        for scenario in scenarios
    )
