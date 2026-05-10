"""Tests for signals/composite.py — CompositeScorer weighted multi-factor scoring."""

import pytest

from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.composite import DEFAULT_WEIGHTS, CompositeScorer


def _factor(name, score, confidence=0.7, data_quality=0.8, value=0.0,
            threshold_breached=False):
    return FactorSignal(
        name=name, score=score, confidence=confidence,
        value=value, threshold_breached=threshold_breached,
        data_quality=data_quality,
    )


# ---------------------------------------------------------------------------
# CompositeScorer
# ---------------------------------------------------------------------------


class TestCompositeScorer:
    def test_no_factors_neutral(self):
        scorer = CompositeScorer()
        result = scorer.score([], symbol="BTC/USDT")
        assert result.score == SignalScore.NEUTRAL
        assert result.confidence >= 0

    def test_single_bullish_factor(self):
        scorer = CompositeScorer()
        result = scorer.score(
            [_factor("funding_oi", SignalScore.BUY, confidence=0.8)],
            symbol="BTC/USDT",
        )
        assert result.score in (SignalScore.BUY, SignalScore.STRONG_BUY)

    def test_single_bearish_factor(self):
        scorer = CompositeScorer()
        result = scorer.score(
            [_factor("regime", SignalScore.SELL, confidence=0.8)],
            symbol="BTC/USDT",
        )
        assert result.score in (SignalScore.SELL, SignalScore.STRONG_SELL)

    def test_multiple_factors_same_direction(self):
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=0.9),
            _factor("regime", SignalScore.STRONG_BUY, confidence=0.85),
            _factor("onchain", SignalScore.BUY, confidence=0.7),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.score == SignalScore.STRONG_BUY
        assert result.confidence > 0.5

    def test_conflicting_factors_neutral(self):
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=0.9),
            _factor("regime", SignalScore.SELL, confidence=0.9),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.score == SignalScore.NEUTRAL

    def test_strong_buy_threshold(self):
        factors = [
            _factor("funding_oi", SignalScore.STRONG_BUY, confidence=1.0),
            _factor("regime", SignalScore.STRONG_BUY, confidence=1.0),
            _factor("onchain", SignalScore.STRONG_BUY, confidence=1.0),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.score == SignalScore.STRONG_BUY

    def test_strong_sell_threshold(self):
        factors = [
            _factor("funding_oi", SignalScore.STRONG_SELL, confidence=1.0),
            _factor("regime", SignalScore.STRONG_SELL, confidence=1.0),
            _factor("onchain", SignalScore.STRONG_SELL, confidence=1.0),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.score == SignalScore.STRONG_SELL

    def test_low_data_quality_reduces_impact(self):
        hi_q_factor = _factor("funding_oi", SignalScore.BUY, confidence=0.9, data_quality=1.0)
        lo_q_factor = _factor("rsi_divergence", SignalScore.SELL, confidence=0.9, data_quality=0.1)
        scorer = CompositeScorer()
        result = scorer.score([hi_q_factor, lo_q_factor], symbol="BTC/USDT")
        # High quality BUY should dominate low quality SELL
        assert result.score in (SignalScore.BUY, SignalScore.STRONG_BUY)

    def test_agreement_bonus(self):
        # All factors pointing the same way triggers agreement bonus
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=0.8),
            _factor("regime", SignalScore.BUY, confidence=0.8),
            _factor("onchain", SignalScore.BUY, confidence=0.8),
            _factor("volume_profile", SignalScore.BUY, confidence=0.8),
            _factor("liquidations", SignalScore.BUY, confidence=0.8),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.confidence >= 0.60

    def test_volatility_discount(self):
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=0.9),
            _factor("regime", SignalScore.BUY, confidence=0.9),
        ]
        normal = CompositeScorer()
        normal_result = normal.score(factors, symbol="BTC/USDT", volatility_regime="normal")
        extreme = CompositeScorer()
        extreme_result = extreme.score(factors, symbol="BTC/USDT", volatility_regime="extreme")
        assert extreme_result.confidence < normal_result.confidence

    def test_neutral_factors_contribute_zero(self):
        factors = [
            _factor("funding_oi", SignalScore.NEUTRAL, confidence=0.9),
            _factor("regime", SignalScore.NEUTRAL, confidence=0.9),
            _factor("onchain", SignalScore.NEUTRAL, confidence=0.9),
        ]
        scorer = CompositeScorer()
        result = scorer.score(factors, symbol="BTC/USDT")
        assert result.score == SignalScore.NEUTRAL

    def test_custom_thresholds(self):
        scorer = CompositeScorer(buy_threshold=0.10, strong_buy_threshold=0.99)
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=0.6),
        ]
        result = scorer.score(factors, symbol="BTC/USDT")
        # Strong buy threshold is nearly unreachable, so moderate BUY stays as BUY
        assert result.score == SignalScore.BUY

    def test_custom_weights(self):
        weights = {"funding_oi": 0.90, "regime": 0.05, "onchain": 0.05}
        scorer = CompositeScorer(weights=weights)
        factors = [
            _factor("funding_oi", SignalScore.BUY, confidence=1.0),
            _factor("regime", SignalScore.SELL, confidence=1.0),
        ]
        result = scorer.score(factors, symbol="BTC/USDT")
        # funding_oi has 0.90 weight, should dominate
        assert result.score in (SignalScore.BUY, SignalScore.STRONG_BUY)

    def test_result_includes_summary(self):
        scorer = CompositeScorer()
        result = scorer.score(
            [_factor("funding_oi", SignalScore.BUY, confidence=0.8)],
            symbol="BTC/USDT",
        )
        assert "Composite score" in result.summary

    def test_to_prompt_block(self):
        result = SignalResult(
            symbol="BTC/USDT", timestamp="2026-01-01T00:00:00Z",
            score=SignalScore.BUY, confidence=0.75,
            factors=[_factor("funding_oi", SignalScore.BUY, confidence=0.8)],
            current_price=50000.0,
        )
        block = result.to_prompt_block()
        assert "BTC/USDT" in block
        assert "Buy" in block
        assert "50000" in block

    def test_to_dict(self):
        result = SignalResult(
            symbol="BTC/USDT", timestamp="2026-01-01T00:00:00Z",
            score=SignalScore.BUY, confidence=0.75,
            factors=[_factor("funding_oi", SignalScore.BUY, confidence=0.8)],
        )
        d = result.to_dict()
        assert d["symbol"] == "BTC/USDT"
        assert d["score"] == "Buy"
        assert len(d["factors"]) == 1
        assert d["factors"][0]["name"] == "funding_oi"


# ---------------------------------------------------------------------------
# DEFAULT_WEIGHTS
# ---------------------------------------------------------------------------


class TestDefaultWeights:
    def test_weights_sum_near_one(self):
        total = sum(DEFAULT_WEIGHTS.values())
        assert 0.95 < total < 1.05

    def test_all_signal_categories_present(self):
        for key in ("funding_oi", "rsi_divergence", "macd", "volume_profile",
                     "liquidations", "regime", "onchain"):
            assert key in DEFAULT_WEIGHTS
