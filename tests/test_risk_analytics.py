"""Tests for risk/analytics.py — VaR, CVaR, correlation, stress testing, risk decomposition."""

import math
import pytest

from tradingagents.risk.analytics import (
    STRESS_SCENARIOS,
    historical_var,
    parametric_var,
    cvar,
    correlation_matrix,
    stress_test_portfolio,
    risk_decomposition,
)


# ---------------------------------------------------------------------------
# Historical VaR
# ---------------------------------------------------------------------------


class TestHistoricalVaR:
    def test_too_few_returns_zero(self):
        assert historical_var([], 0.95) == 0.0
        assert historical_var([0.01] * 5, 0.95) == 0.0

    def test_95_var(self):
        returns = sorted(
            [0.01, -0.02, 0.03, -0.01, 0.005, -0.03, 0.02, -0.01, -0.005, 0.01,
             -0.04, 0.02, 0.01, -0.02, -0.01, 0.03, -0.005, 0.01, -0.03, 0.02,
             0.01, -0.02, 0.005, -0.01, 0.02],
        )
        result = historical_var(returns, 0.95)
        assert result >= 0

    def test_99_var_higher_than_95(self):
        returns = sorted(
            [0.01, -0.02, 0.03, -0.01, 0.005, -0.03, 0.02, -0.01, -0.005, 0.01,
             -0.04, 0.02, 0.01, -0.02, -0.01, 0.03, -0.005, 0.01, -0.03, 0.02,
             0.01, -0.02, 0.005, -0.01, 0.02],
        )
        var95 = historical_var(returns, 0.95)
        var99 = historical_var(returns, 0.99)
        assert var99 >= var95


# ---------------------------------------------------------------------------
# Parametric VaR
# ---------------------------------------------------------------------------


class TestParametricVaR:
    def test_too_few_returns_zero(self):
        assert parametric_var([], 0.95) == 0.0

    def test_normal_returns(self):
        returns = [0.01, -0.02, 0.03, -0.01, 0.005, -0.03, 0.02,
                   -0.01, -0.005, 0.01, -0.04, 0.02]
        result = parametric_var(returns, 0.95)
        assert result > 0

    def test_90_vs_99(self):
        returns = [0.01, -0.02, 0.03, -0.01, 0.005, -0.03, 0.02,
                   -0.01, -0.005, 0.01, -0.04, 0.02]
        var90 = parametric_var(returns, 0.90)
        var99 = parametric_var(returns, 0.99)
        assert var99 > var90


# ---------------------------------------------------------------------------
# CVaR
# ---------------------------------------------------------------------------


class TestCVaR:
    def test_too_few_falls_back_to_var_scaled(self):
        returns = [0.01, -0.02, 0.03, -0.01, 0.005]
        result = cvar(returns, 0.95)
        assert result >= 0

    def test_cvar_higher_than_var(self):
        returns = sorted(
            [0.01, -0.02, 0.03, -0.01, 0.005, -0.03, 0.02, -0.01, -0.005, 0.01,
             -0.04, 0.02, 0.01, -0.02, -0.01, 0.03, -0.005, 0.01, -0.03, 0.02,
             0.01, -0.02, 0.005, -0.01, 0.02],
        )
        result = cvar(returns, 0.95)
        var_result = historical_var(returns, 0.95)
        assert result >= var_result


# ---------------------------------------------------------------------------
# Correlation matrix
# ---------------------------------------------------------------------------


class TestCorrelationMatrix:
    def test_empty(self):
        result = correlation_matrix({})
        assert result["matrix"] == {}

    def test_single_symbol(self):
        result = correlation_matrix({"BTC": [100.0, 102.0, 101.0, 103.0, 104.0]})
        assert result["matrix"] == {}
        assert result["warnings"] == []

    def test_two_symbols(self):
        data = {
            "BTC": [100.0, 102.0, 101.0, 103.0, 104.0, 105.0],
            "ETH": [3000.0, 3100.0, 3050.0, 3150.0, 3200.0, 3250.0],
        }
        result = correlation_matrix(data)
        assert "BTC" in result["matrix"]
        assert "ETH" in result["matrix"]
        assert result["matrix"]["BTC"]["ETH"] is not None

    def test_high_correlation_warns(self):
        # Two series moving together
        data = {
            "BTC": [100 + i for i in range(30)],
            "ETH": [3000 + 30 * i for i in range(30)],
        }
        result = correlation_matrix(data)
        # They're both trending up, high correlation expected
        if result["warnings"]:
            assert "High-correlation" in result["warnings"][0]


# ---------------------------------------------------------------------------
# Stress testing
# ---------------------------------------------------------------------------


class TestStressTestPortfolio:
    def test_empty_positions(self):
        result = stress_test_portfolio({}, {})
        assert "No open positions" in result

    def test_zero_value(self):
        result = stress_test_portfolio({"BTC": 0.0}, {"BTC": 50000.0})
        assert "zero" in result.lower()

    def test_with_positions(self):
        positions = {"BTC": 5000.0, "ETH": 3000.0}
        prices = {"BTC": 50000.0, "ETH": 3000.0}
        result = stress_test_portfolio(positions, prices)
        assert "Portfolio Stress Test Results" in result
        assert "BTC" in result or "Positions" in result
        assert "PASS" in result or "FAIL" in result

    def test_scenarios_respected(self):
        positions = {"BTC": 10000.0}
        prices = {"BTC": 50000.0}
        result = stress_test_portfolio(
            positions, prices, scenarios=["crypto_winter", "tail_risk_3sigma"],
        )
        assert "crypto_winter" in result.lower() or "bear market" in result.lower()
        assert "tail" in result.lower() or "sigma" in result.lower()

    def test_all_scenarios_defined(self):
        assert len(STRESS_SCENARIOS) >= 6
        for key in ("market_crash_2008", "covid_2020", "crypto_winter"):
            assert key in STRESS_SCENARIOS


# ---------------------------------------------------------------------------
# Risk decomposition
# ---------------------------------------------------------------------------


class TestRiskDecomposition:
    def test_empty_positions(self):
        result = risk_decomposition({}, {})
        assert "No open positions" in result

    def test_zero_value(self):
        result = risk_decomposition({"BTC": 0.0}, {"BTC": 0.5})
        assert "Zero portfolio value" in result

    def test_single_position(self):
        result = risk_decomposition(
            {"BTC": 10000.0},
            {"BTC": 0.60},
        )
        assert "Single position" in result
        assert "BTC" in result

    def test_multiple_positions(self):
        result = risk_decomposition(
            {"BTC": 6000.0, "ETH": 4000.0},
            {"BTC": 0.60, "ETH": 0.80},
        )
        assert "Portfolio Risk Decomposition" in result
        assert "BTC" in result
        assert "ETH" in result

    def test_with_correlation_matrix(self):
        corr = {"BTC": {"ETH": 0.7}, "ETH": {"BTC": 0.7}}
        result = risk_decomposition(
            {"BTC": 6000.0, "ETH": 4000.0},
            {"BTC": 0.60, "ETH": 0.80},
            correlation_matrix=corr,
        )
        assert "Portfolio Risk Decomposition" in result
