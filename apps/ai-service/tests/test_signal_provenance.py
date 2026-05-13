from datetime import datetime, timedelta, timezone

from tradingagents.domain import (
    DataFreshness,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
)
from tradingagents.graph import ResearchAgentsGraph
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.provenance import (
    freshness_from_timestamp,
    parse_signal_timestamp,
    signal_result_to_domain_signals,
    signal_score_to_direction,
)
from tradingagents.signals.rules import (
    build_watch_condition_payload,
    canonical_signal_type,
    classify_signal,
    normalize_signal_payload,
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


def test_freshness_policy_uses_configurable_max_age_hours():
    now = datetime(2026, 5, 8, tzinfo=timezone.utc)
    source_timestamp = now - timedelta(hours=6)

    fresh, _ = freshness_from_timestamp(
        source_timestamp,
        now=now,
        max_age_hours=8,
    )
    stale, _ = freshness_from_timestamp(
        source_timestamp,
        now=now,
        max_age_hours=4,
    )

    assert fresh == DataFreshness.FRESH
    assert stale == DataFreshness.STALE


def test_signal_conversion_applies_max_age_hours_override():
    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T06:00:00Z")

    signals = signal_result_to_domain_signals(result, now=now, max_age_hours=4)

    assert signals[0].provenance.freshness == DataFreshness.STALE
    assert signals[0].provenance.freshness_seconds == 21600


def test_signal_result_to_domain_signals_preserves_provenance_and_evidence():
    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T10:00:00Z")

    signals = signal_result_to_domain_signals(result, now=now)

    assert len(signals) == 3
    composite = signals[0]
    funding = signals[1]
    assert composite.signal_type == "quant_bias"
    assert composite.direction == SignalDirection.BULLISH
    assert composite.evidence_lane.value == "quant_bias"
    assert composite.provenance.source == "signal_engine"
    assert composite.provenance.freshness == DataFreshness.FRESH
    assert composite.evidence["quant_bias"] == "bullish"
    assert composite.evidence["trend_direction"] == "bullish"
    assert "perp" in composite.evidence
    assert funding.signal_type == "funding_oi"
    assert funding.direction == SignalDirection.BEARISH
    assert funding.evidence_lane.value == "perp"
    assert funding.evidence_category == "funding_oi"
    assert funding.evidence["quant_bias"] == "bearish"
    assert funding.evidence["threshold_breached"] is True
    assert funding.provenance.metadata["data_quality"] == 0.8
    assert "funding percentile rises above 90%" in (
        funding.watch_conditions.review_trigger
    )
    assert "funding resets to neutral" in funding.watch_conditions.invalidation


def test_signal_rule_registry_maps_legacy_aliases_and_concrete_triggers():
    assert canonical_signal_type("composite_quant") == "quant_bias"
    assert classify_signal("funding_oi") == ("funding_oi", "perp", "funding_oi")
    assert classify_signal("long_short_ratio") == (
        "long_short",
        "perp",
        "long_short",
    )
    assert classify_signal("macd") == ("macd", "spot", "price")
    assert classify_signal("regime") == ("regime", "spot", "regime")
    assert classify_signal("onchain") == ("onchain", "spot", "on-chain")

    macd_watch = build_watch_condition_payload(
        symbol="ETH/USDT",
        signal_type="macd",
        direction="bearish",
        lane="spot",
        category="price",
        confidence=0.65,
    )

    assert "histogram flips sign" in macd_watch["review_trigger"]
    assert "opposite direction" in macd_watch["invalidation"]


def test_legacy_signal_payload_normalizes_to_registry_defaults():
    payload = {
        "id": "sig_legacy",
        "symbol": "ETH/USDT",
        "signal_type": "composite_quant",
        "direction": "neutral",
        "confidence": 0.07,
        "observed_at": "2026-05-12T18:43:28Z",
        "provenance": {
            "source": "signal_engine",
            "observed_at": "2026-05-12T18:43:28Z",
            "metadata": {"score": "Neutral", "factor_count": 7},
        },
        "evidence": {"score": "Neutral"},
    }

    normalized = normalize_signal_payload(payload)

    assert normalized["signal_type"] == "quant_bias"
    assert normalized["evidence_lane"] == "quant_bias"
    assert normalized["evidence_category"] == "aggregate"
    assert normalized["evidence"]["quant_bias"] == "neutral"
    assert normalized["watch_conditions"]["review_trigger"]


def test_parse_signal_timestamp_returns_none_for_invalid_timestamp():
    assert parse_signal_timestamp("not-a-timestamp") is None
    assert parse_signal_timestamp(None) is None


def test_thesis_signal_classification_by_direction():
    graph = ResearchAgentsGraph.__new__(ResearchAgentsGraph)
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


# ---------------------------------------------------------------------------
# Phase 4 (tail): build_reliability_map_from_evaluations
# ---------------------------------------------------------------------------


def test_build_reliability_map_from_evaluations_empty():
    from tradingagents.signals.provenance import build_reliability_map_from_evaluations

    result = build_reliability_map_from_evaluations([])
    assert result == {}


def test_build_reliability_map_from_factor_reliability_objects():
    from tradingagents.signals.provenance import build_reliability_map_from_evaluations
    from tradingagents.domain.calibration import FactorReliability

    factors = [
        FactorReliability(
            factor_name="funding_oi",
            sample_size=50,
            hit_rate=0.65,
            directional_accuracy=0.70,
        ),
        FactorReliability(
            factor_name="rsi_divergence",
            sample_size=40,
            hit_rate=0.55,
            directional_accuracy=0.60,
        ),
        FactorReliability(
            factor_name="regime",
            sample_size=30,
            hit_rate=0.80,
            directional_accuracy=0.85,
        ),
    ]

    result = build_reliability_map_from_evaluations(factors)
    assert len(result) == 3
    assert result["funding_oi"]["historical_reliability"] == 0.65
    assert result["funding_oi"]["sample_size"] == 50
    assert result["rsi_divergence"]["historical_reliability"] == 0.55
    assert result["regime"]["historical_reliability"] == 0.80


def test_build_reliability_map_skips_nameless():
    from tradingagents.signals.provenance import build_reliability_map_from_evaluations

    class NamelessEval:
        factor_name = None
        historical_reliability = 0.5
        sample_size = 10

    result = build_reliability_map_from_evaluations([NamelessEval()])
    assert result == {}


def test_reliability_map_passed_to_signal_result():
    from tradingagents.signals.provenance import signal_result_to_domain_signals

    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T10:00:00Z")

    reliability_map = {
        "funding_oi": {"historical_reliability": 0.65, "sample_size": 50},
        "regime": {"historical_reliability": 0.80, "sample_size": 30},
        "quant_bias": {"historical_reliability": 0.72, "sample_size": 60},
    }

    signals = signal_result_to_domain_signals(
        result, now=now, reliability_map=reliability_map
    )

    # Check composite signal
    composite = signals[0]
    assert composite.provenance.historical_reliability == 0.72
    assert composite.provenance.sample_size == 60

    # Check per-factor signals
    funding = signals[1]
    assert funding.provenance.historical_reliability == 0.65
    assert funding.provenance.sample_size == 50

    regime = signals[2]
    assert regime.provenance.historical_reliability == 0.80
    assert regime.provenance.sample_size == 30


def test_legacy_composite_quant_reliability_key_still_maps_to_quant_bias():
    from tradingagents.signals.provenance import signal_result_to_domain_signals

    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T10:00:00Z")

    signals = signal_result_to_domain_signals(
        result,
        now=now,
        reliability_map={
            "composite_quant": {"historical_reliability": 0.72, "sample_size": 60}
        },
    )

    assert signals[0].signal_type == "quant_bias"
    assert signals[0].provenance.historical_reliability == 0.72
    assert signals[0].provenance.sample_size == 60


def test_reliability_map_missing_key_no_effect():
    from tradingagents.signals.provenance import signal_result_to_domain_signals

    now = datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc)
    result = _sample_result("2026-05-08T10:00:00Z")

    reliability_map = {
        "some_other_signal": {"historical_reliability": 0.99, "sample_size": 999},
    }

    signals = signal_result_to_domain_signals(
        result, now=now, reliability_map=reliability_map
    )

    # None of the signals should have reliability set
    for signal in signals:
        assert signal.provenance.historical_reliability is None
        assert signal.provenance.sample_size is None
