from tradingagents.domain import (
    DataFreshness,
    PlanningStatus,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
    TradeThesis,
)
from tradingagents.graph.trading_graph import _make_planning_result


def test_research_run_defaults_to_crypto_research_lifecycle():
    run = ResearchRun(symbol="BTC/USDT")

    assert run.asset_class == "crypto"
    assert run.status == ResearchRunStatus.CREATED
    assert run.signal_ids == []


def test_signal_requires_provenance_and_direction():
    signal = Signal(
        symbol="BTC/USDT",
        signal_type="funding_extreme",
        direction=SignalDirection.BEARISH,
        confidence=0.64,
        provenance=SignalProvenance(
            source="coinglass",
            freshness=DataFreshness.FRESH,
        ),
        evidence={"funding_percentile_30d": 96},
    )

    assert signal.provenance.source == "coinglass"
    assert signal.evidence["funding_percentile_30d"] == 96


def test_trade_thesis_is_recommendation_not_order():
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.WATCH,
        thesis_text="Wait for reclaim confirmation before considering a plan.",
        risk_notes=["Manual review required before any exchange action."],
    )

    assert thesis.direction == ThesisDirection.WATCH
    assert "Manual review" in thesis.risk_notes[0]


def test_planning_result_uses_legacy_cli_shape_without_execution():
    result = _make_planning_result(
        "planned",
        "BTC/USDT",
        "AI-generated thesis only.",
        action="watch",
        rating="Hold",
        confidence=0.51,
    )

    assert result["status"] == PlanningStatus.PLANNED.value
    assert result["symbol"] == "BTC/USDT"
    assert result["order_id"] is None
    assert result["filled"] == 0
