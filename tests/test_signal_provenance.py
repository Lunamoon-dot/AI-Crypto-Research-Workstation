from datetime import datetime, timedelta, timezone

from tradingagents.domain import DataFreshness, Signal, SignalDirection, SignalProvenance, ThesisDirection
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.provenance import (
    freshness_from_timestamp,
    parse_signal_timestamp,
    signal_result_to_domain_signals,
    signal_score_to_direction,
)


def _sample_result(timestamp: str) -> SignalResult:
    return SignalResult(
        symbol="BTC/USDT",
        timestamp=timestamp,
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
                name="funding_oi",
                score=SignalScore.SELL,
                confidence=0.61,
                value=0.08,
                threshold_breached=True,
                data_quality=0.8,
                detail="Funding elevated.",
                metadata={"source": "test"},
            ),
            FactorSignal(
                name="regime",
                score=SignalScore.BUY,
                confidence=0.7,
                value=1.0,
                threshold_breached=False,
                data_quality=0.9,
                detail="Trend intact.",
            ),
        ],
    )


def test_signal_score_to_direction_mapping():
    assert signal_score_to_direction(SignalScore.STRONG_BUY) == SignalDirection.BULLISH
    assert signal_score_to_direction(SignalScore.BUY) == SignalDirection.BULLISH
    assert signal_score_to_direction(SignalScore.SELL) == SignalDirection.BEARISH
    assert signal_score_to_direction(SignalScore.STRONG_SELL) == SignalDirection.BEARISH
    assert signal_score_to_direction(SignalScore.NEUTRAL) == SignalDirection.NEUTRAL


def test_freshness_policy_recent_old_and_unknown():
    now = datetime(2026, 5, 8, tzinfo=timezone.utc)

    fresh, fresh_age = freshness_from_timestamp(now - timedelta(hours=2), now=now)
    stale, stale_age = freshness_from_timestamp(now - timedelta(days=2), now=now)
    unknown, unknown_age = freshness_from_timestamp(None, now=now)

    assert fresh == DataFreshness.FRESH
    assert fresh_age == 7200
    assert stale == DataFreshness.STALE
    assert stale_age == 172800
    assert unknown == DataFreshness.UNKNOWN
    assert unknown_age is None


def test_signal_result_to_domain_signals_preserves_provenance_and_evidence():
    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T10:00:00Z")

    signals = signal_result_to_domain_signals(result, now=now)

    assert len(signals) == 3
    composite = signals[0]
    funding = signals[1]
    assert composite.signal_type == "composite_quant"
    assert composite.direction == SignalDirection.BULLISH
    assert composite.provenance.source == "signal_engine"
    assert composite.provenance.freshness == DataFreshness.FRESH
    assert composite.evidence["trend_direction"] == "bullish"
    assert funding.signal_type == "funding_oi"
    assert funding.direction == SignalDirection.BEARISH
    assert funding.evidence["threshold_breached"] is True
    assert funding.provenance.metadata["data_quality"] == 0.8


def test_parse_signal_timestamp_returns_none_for_invalid_timestamp():
    assert parse_signal_timestamp("not-a-timestamp") is None
    assert parse_signal_timestamp(None) is None


def test_thesis_signal_classification_by_direction():
    graph = TradingAgentsGraph.__new__(TradingAgentsGraph)
    graph.current_signals = [
        Signal(
            id="sig_bull",
            symbol="BTC/USDT",
            signal_type="regime",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        ),
        Signal(
            id="sig_bear",
            symbol="BTC/USDT",
            signal_type="funding_oi",
            direction=SignalDirection.BEARISH,
            provenance=SignalProvenance(source="test"),
        ),
    ]

    long_support, long_contra = graph._classify_thesis_signals(ThesisDirection.LONG)
    short_support, short_contra = graph._classify_thesis_signals(ThesisDirection.SHORT)
    watch_support, watch_contra = graph._classify_thesis_signals(ThesisDirection.WATCH)

    assert long_support == ["sig_bull"]
    assert long_contra == ["sig_bear"]
    assert short_support == ["sig_bear"]
    assert short_contra == ["sig_bull"]
    assert watch_support == []
    assert watch_contra == []
