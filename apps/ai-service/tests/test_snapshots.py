from tradingagents.domain import (
    DataFreshness,
    Signal,
    SignalDirection,
    SignalProvenance,
)
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.provenance import signal_result_to_domain_signals
from tradingagents.signals.snapshots import build_market_snapshot, build_signal_snapshot


def _result() -> SignalResult:
    return SignalResult(
        symbol="BTC/USDT",
        timestamp="2026-05-08T10:00:00Z",
        score=SignalScore.BUY,
        confidence=0.72,
        current_price=100000.0,
        trend_direction="bullish",
        trend_strength=0.67,
        volatility_regime="normal",
        market_regime="trending",
        summary="Composite bullish signal.",
        factors=[
            FactorSignal(
                name="regime",
                score=SignalScore.BUY,
                confidence=0.7,
                value=1.0,
                threshold_breached=False,
            )
        ],
    )


def test_build_market_snapshot_from_signal_result():
    snapshot = build_market_snapshot(_result(), research_run_id="run_1")

    assert snapshot.research_run_id == "run_1"
    assert snapshot.symbol == "BTC/USDT"
    assert snapshot.current_price == 100000.0
    assert snapshot.trend_direction == "bullish"
    assert snapshot.payload["quant_bias"] == "bullish"


def test_build_signal_snapshot_counts_direction_and_freshness():
    signals = [
        Signal(
            id="sig_bull",
            symbol="BTC/USDT",
            signal_type="regime",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test", freshness=DataFreshness.FRESH),
        ),
        Signal(
            id="sig_bear",
            symbol="BTC/USDT",
            signal_type="funding",
            direction=SignalDirection.BEARISH,
            provenance=SignalProvenance(source="test", freshness=DataFreshness.STALE),
        ),
    ]

    snapshot = build_signal_snapshot(
        research_run_id="run_1",
        symbol="BTC/USDT",
        signals=signals,
    )

    assert snapshot.signal_ids == ["sig_bull", "sig_bear"]
    assert snapshot.bullish_count == 1
    assert snapshot.bearish_count == 1
    assert snapshot.stale_count == 1


def test_signal_result_domain_signals_can_feed_signal_snapshot():
    signals = signal_result_to_domain_signals(_result())
    for idx, signal in enumerate(signals):
        signal.id = f"sig_{idx}"

    snapshot = build_signal_snapshot(
        research_run_id="run_1",
        symbol="BTC/USDT",
        signals=signals,
    )

    assert snapshot.composite_signal_id == "sig_0"
    assert len(snapshot.signal_ids) == 2
