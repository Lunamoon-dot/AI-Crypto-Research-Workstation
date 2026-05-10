"""Tests for PositionSizer and sizing helpers in risk/sizing.py."""

import pytest

from tradingagents.risk.sizing import (
    FIXED_SIZING,
    PositionSizer,
    _extract_percentage,
    _safe_float,
    compute_annualized_volatility,
    compute_atr,
)

# ---------------------------------------------------------------------------
# _safe_float
# ---------------------------------------------------------------------------


class TestSafeFloat:
    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_int(self):
        assert _safe_float(5) == 5.0

    def test_float(self):
        assert _safe_float(3.14) == 3.14

    def test_str_with_percent(self):
        assert _safe_float("12.5%") == 12.5

    def test_str_plain(self):
        assert _safe_float("0.25") == 0.25

    def test_invalid_str(self):
        assert _safe_float("nope") is None


# ---------------------------------------------------------------------------
# _extract_percentage
# ---------------------------------------------------------------------------


class TestExtractPercentage:
    def test_empty_string(self):
        assert _extract_percentage("") is None

    def test_none(self):
        assert _extract_percentage(None) is None

    def test_percent_sign(self):
        assert _extract_percentage("Allocate 15% of portfolio") == 15.0

    def test_percent_sign_decimal(self):
        assert _extract_percentage("Size: 7.5% of portfolio") == 7.5

    def test_word_percent(self):
        assert _extract_percentage("allocate 10 percent") == 10.0

    def test_allocate_fraction(self):
        assert _extract_percentage("allocate 0.15 of portfolio") == 15.0

    def test_no_match(self):
        assert _extract_percentage("Enter position with conviction") is None


# ---------------------------------------------------------------------------
# compute_annualized_volatility & compute_atr
# ---------------------------------------------------------------------------


class TestComputeStats:
    def test_volatility_too_few_prices(self):
        assert compute_annualized_volatility([100.0]) is None

    def test_volatility_constant_prices(self):
        prices = [100.0] * 10
        result = compute_annualized_volatility(prices)
        assert result is not None
        assert result == 0.0

    def test_volatility_normal(self):
        prices = [100, 102, 101, 103, 104, 102, 105, 107, 106, 108]
        result = compute_annualized_volatility(prices)
        assert result is not None
        assert 0.0 < result < 2.0  # reasonable annualized vol

    def test_atr_too_few_bars(self):
        assert compute_atr([1], [1], [1]) is None

    def test_atr_normal(self):
        highs = [10 + i * 0.5 + (i % 3) * 0.3 for i in range(30)]
        lows = [10 + i * 0.5 - (i % 2) * 0.2 for i in range(30)]
        closes = [10 + i * 0.5 + (i % 4) * 0.1 for i in range(30)]
        result = compute_atr(highs, lows, closes)
        assert result is not None
        assert result > 0


# ---------------------------------------------------------------------------
# PositionSizer
# ---------------------------------------------------------------------------


DEFAULT_CONFIG = {
    "planning": {"position_sizing": "fixed"},
    "fixed_sizing": FIXED_SIZING,
}


class TestFixedSizing:
    def test_buy(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, reason = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]
        assert "Fixed sizing" in reason

    def test_overweight(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, _ = sizer.calculate("Overweight", 10000, 0.0)
        assert alloc == FIXED_SIZING["overweight"]

    def test_hold(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, _ = sizer.calculate("Hold", 10000, 0.5)
        assert alloc == 0.0

    def test_sell(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, _ = sizer.calculate("Sell", 10000, 0.0)
        assert alloc == FIXED_SIZING["sell"]

    def test_underweight(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, _ = sizer.calculate("Underweight", 10000, 0.0)
        assert alloc == FIXED_SIZING["underweight"]

    def test_unknown_rating_zero(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, reason = sizer.calculate("Nonsense", 10000, 0.0)
        assert alloc == 0.0

    def test_case_insensitive(self):
        sizer = PositionSizer(DEFAULT_CONFIG)
        alloc, _ = sizer.calculate("BUY", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]


class TestKellySizing:
    def test_insufficient_data_falls_back(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "kelly"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]
        assert "insufficient" in reason.lower()

    def test_kelly_buy_with_good_stats(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "kelly"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Buy", 10000, 0.0,
            win_rate=0.6, avg_win=0.05, avg_loss=-0.03,
        )
        assert alloc > 0
        assert "Kelly sizing" in reason

    def test_kelly_sell(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "kelly"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Sell", 10000, 0.0,
            win_rate=0.6, avg_win=0.05, avg_loss=-0.03,
        )
        assert alloc < 0

    def test_kelly_hold_is_zero(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "kelly"}}
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate(
            "Hold", 10000, 0.0,
            win_rate=0.6, avg_win=0.05, avg_loss=-0.03,
        )
        assert alloc == 0.0


class TestVolatilitySizing:
    def test_no_vol_data_falls_back(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "volatility"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]
        assert "no volatility" in reason.lower()

    def test_volatility_buy(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "volatility"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Buy", 10000, 0.0, volatility=0.40,
        )
        assert alloc > 0
        assert "Volatility sizing" in reason

    def test_volatility_sell(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "volatility"}}
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate(
            "Sell", 10000, 0.0, volatility=0.40,
        )
        assert alloc < 0

    def test_volatility_capped_at_max(self):
        config = {
            **DEFAULT_CONFIG,
            "planning": {"position_sizing": "volatility", "risk_limits": {"max_position_size_pct": 30}},
            "volatility_target_daily": 0.01,
        }
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate(
            "Buy", 10000, 0.0, volatility=0.10,  # very low vol
        )
        assert alloc <= sizer.max_position_pct


class TestATRSizing:
    def test_insufficient_atr_falls_back(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "atr"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]
        assert "insufficient" in reason.lower()

    def test_atr_buy(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "atr"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Buy", 10000, 0.0, atr=2.5, price=50.0,
        )
        assert alloc > 0
        assert "ATR sizing" in reason

    def test_atr_sell(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "atr"}}
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate(
            "Sell", 10000, 0.0, atr=2.5, price=50.0,
        )
        assert alloc < 0


class TestLLMSizing:
    def test_parses_percentage_from_sizing_str(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "llm"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Buy", 10000, 0.0, trader_sizing_str="Allocate 12% of portfolio",
        )
        assert alloc == 0.12
        assert "LLM suggested" in reason

    def test_negates_bearish_rating(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "llm"}}
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate(
            "Sell", 10000, 0.0, trader_sizing_str="Reduce by 10%",
        )
        assert alloc == -0.10

    def test_hold_action_zero(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "llm"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate(
            "Buy", 10000, 0.0, trader_action="Hold",
        )
        assert alloc == 0.0

    def test_no_sizing_falls_back_to_fixed(self):
        config = {**DEFAULT_CONFIG, "planning": {"position_sizing": "llm"}}
        sizer = PositionSizer(config)
        alloc, reason = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == FIXED_SIZING["buy"]
        assert "fallback" in reason.lower()


class TestCustomFixedSizing:
    def test_user_override(self):
        config = {
            "planning": {"position_sizing": "fixed"},
            "fixed_sizing": {"buy": 0.50, "sell": -1.0},
        }
        sizer = PositionSizer(config)
        alloc, _ = sizer.calculate("Buy", 10000, 0.0)
        assert alloc == 0.50
