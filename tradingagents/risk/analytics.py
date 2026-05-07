"""Portfolio risk analytics — VaR, CVaR, correlation, stress testing.

Provides quantitative risk metrics for pre-trade checks and portfolio-level
monitoring.  All functions are deterministc — no LLM calls.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# VaR & CVaR
# ---------------------------------------------------------------------------


def historical_var(
    returns: list[float], confidence: float = 0.95
) -> float:
    """Historical Value-at-Risk at the given confidence level.

    Parameters
    ----------
    returns : list of daily return decimals (e.g. 0.02 = +2%)
    confidence : 0.95 for 95% VaR, 0.99 for 99% VaR

    Returns
    -------
    VaR as a positive decimal (e.g. 0.03 = 3% loss).  Always ≥ 0.
    """
    if len(returns) < 20:
        return 0.0
    sorted_returns = sorted(returns)
    cutoff = int(len(sorted_returns) * (1.0 - confidence))
    var = -sorted_returns[cutoff] if cutoff < len(sorted_returns) else 0.0
    return max(0.0, float(var))


def parametric_var(
    returns: list[float], confidence: float = 0.95
) -> float:
    """Parametric VaR assuming normal distribution.

    VaR = μ - σ × z_score  (expressed as a positive loss).
    """
    import math
    from statistics import mean, stdev

    if len(returns) < 5:
        return 0.0

    mu = mean(returns)
    sigma = stdev(returns) if len(returns) > 1 else 0.0

    # z-scores for common confidence levels
    z_scores = {0.90: 1.282, 0.95: 1.645, 0.975: 1.960, 0.99: 2.326, 0.999: 3.090}
    z = z_scores.get(confidence, 1.645)

    var = -(mu - z * sigma)
    return max(0.0, float(var))


def cvar(
    returns: list[float], confidence: float = 0.95
) -> float:
    """Conditional VaR (Expected Shortfall) — average loss beyond VaR."""
    if len(returns) < 20:
        return historical_var(returns, confidence) * 1.5

    sorted_returns = sorted(returns)
    cutoff = int(len(sorted_returns) * (1.0 - confidence))
    tail = sorted_returns[: cutoff + 1]
    if not tail:
        return 0.0
    cvar_val = -float(np.mean(tail))
    return max(0.0, cvar_val)


# ---------------------------------------------------------------------------
# Correlation matrix
# ---------------------------------------------------------------------------


def correlation_matrix(data: dict[str, list[float]]) -> dict:
    """Compute pairwise Pearson correlation between price series.

    Parameters
    ----------
    data : dict mapping symbol → list of daily prices (aligned by date)

    Returns
    -------
    dict with keys:
    - ``matrix``: dict of dict {symbol: {symbol: corr}}
    - ``clusters``: list of highly-correlated groups (|ρ| > 0.7)
    """
    if len(data) < 2:
        return {"matrix": {}, "clusters": [], "warnings": []}

    symbols = list(data.keys())
    n = len(symbols)

    # Convert to returns
    returns = {}
    min_len = float("inf")
    for sym, prices in data.items():
        if len(prices) < 5:
            continue
        rets = []
        for i in range(1, len(prices)):
            if prices[i - 1] > 0:
                rets.append((prices[i] - prices[i - 1]) / prices[i - 1])
        if rets:
            returns[sym] = rets[-min_len:]  # use same length
            min_len = min(min_len, len(rets))

    if len(returns) < 2:
        return {"matrix": {}, "clusters": [], "warnings": []}

    matrix = {s: {} for s in symbols}
    warnings = []

    for i in range(n):
        si = symbols[i]
        if si not in returns:
            continue
        for j in range(n):
            sj = symbols[j]
            if sj not in returns:
                matrix[si][sj] = 1.0 if i == j else None
                continue
            try:
                r = returns[si][:min_len]
                r2 = returns[sj][:min_len]
                if len(r) < 5:
                    matrix[si][sj] = None
                    continue
                corr = float(np.corrcoef(r, r2)[0, 1])
                matrix[si][sj] = round(corr, 3)
            except Exception:
                matrix[si][sj] = None

    # Find high-correlation clusters
    cluster_candidates = []
    for i in range(n):
        for j in range(i + 1, n):
            val = matrix.get(symbols[i], {}).get(symbols[j])
            if val is not None and abs(val) > 0.7:
                cluster_candidates.append((symbols[i], symbols[j], val))

    if cluster_candidates:
        warnings.append(
            "High-correlation pairs detected: "
            + "; ".join(f"{a}-{b} (ρ={v:+.2f})" for a, b, v in cluster_candidates)
        )

    return {"matrix": matrix, "clusters": cluster_candidates, "warnings": warnings}


# ---------------------------------------------------------------------------
# Stress testing
# ---------------------------------------------------------------------------


STRESS_SCENARIOS = {
    "market_crash_2008": {
        "description": "2008-style equity crash: -55% broad market",
        "equity_shock": -0.55,
        "crypto_shock": -0.60,
        "vol_multiplier": 4.0,
        "correlation_spike": True,
    },
    "covid_2020": {
        "description": "COVID-19 shock: -35% rapid drawdown, quick recovery",
        "equity_shock": -0.35,
        "crypto_shock": -0.50,
        "vol_multiplier": 3.0,
        "correlation_spike": True,
    },
    "crypto_winter": {
        "description": "Crypto bear market: -80% from peak, altcoins -90%+",
        "equity_shock": -0.10,
        "crypto_shock": -0.80,
        "vol_multiplier": 5.0,
        "correlation_spike": True,
    },
    "rate_hike": {
        "description": "Aggressive Fed tightening: bonds fall, stocks -20%",
        "equity_shock": -0.20,
        "crypto_shock": -0.30,
        "vol_multiplier": 2.0,
        "correlation_spike": False,
    },
    "stagflation": {
        "description": "Stagflation: -25% stocks, commodities rally",
        "equity_shock": -0.25,
        "crypto_shock": -0.40,
        "vol_multiplier": 2.5,
        "correlation_spike": False,
    },
    "liquidity_crisis": {
        "description": "Liquidity crunch: all risk assets -40%, funding freezes",
        "equity_shock": -0.40,
        "crypto_shock": -0.70,
        "vol_multiplier": 5.0,
        "correlation_spike": True,
    },
    "tail_risk_3sigma": {
        "description": "3-sigma tail event: -45% across all positions",
        "equity_shock": -0.45,
        "crypto_shock": -0.45,
        "vol_multiplier": 3.5,
        "correlation_spike": True,
    },
}


def stress_test_portfolio(
    positions: dict[str, float],     # symbol → current value (USDT)
    prices: dict[str, float],        # symbol → current price
    asset_class: str = "crypto",
    scenarios: Optional[list[str]] = None,
    max_drawdown_pct: float = 0.30,
) -> str:
    """Run stress scenarios against current portfolio positions.

    Parameters
    ----------
    positions : symbol → current notional value in quote currency
    prices : symbol → current close price
    asset_class : crypto
    scenarios : list of scenario keys to run (default: all)
    max_drawdown_pct : threshold for pass/fail (default 0.30 = 30%)

    Returns
    -------
    Formatted stress test report.
    """
    if not positions:
        return "Stress Test: No open positions."

    scenario_keys = scenarios or list(STRESS_SCENARIOS.keys())
    total_value = sum(positions.values())
    if total_value <= 0:
        return "Stress Test: Portfolio value is zero."

    shock_key = "crypto_shock" if asset_class == "crypto" else "equity_shock"

    lines = [
        "Portfolio Stress Test Results",
        "=" * 55,
        f"Total Portfolio Value: ${total_value:,.0f}",
        f"Positions: {len(positions)}",
        f"Asset Class: {asset_class}",
        "",
        f"{'Scenario':<28s} {'Est. P&L':>12s} {'% Impact':>10s} {'Status':>10s}",
        "-" * 62,
    ]

    for key in scenario_keys:
        sc = STRESS_SCENARIOS.get(key)
        if sc is None:
            continue

        shock = sc[shock_key]
        corr_spike = sc["correlation_spike"]

        # Estimate P&L
        if corr_spike:
            # All positions take the full shock (correlation → 1)
            estimated_pnl = total_value * shock
        else:
            # Partial shock — some diversification benefit remains
            estimated_pnl = total_value * shock * 0.7

        impact_pct = estimated_pnl / total_value if total_value > 0 else 0.0
        status = "PASS" if abs(impact_pct) < max_drawdown_pct else "⚠ FAIL"

        lines.append(
            f"{sc['description'][:28]:<28s} "
            f"${estimated_pnl:+,.0f}".rjust(12) + " "
            f"{impact_pct:+.1%}".rjust(10) + " "
            f"{status}".rjust(10)
        )

    lines.append("")
    lines.append(f"Threshold: {max_drawdown_pct:.0%} max drawdown.")
    lines.append(
        "FAIL indicates the scenario exceeds portfolio risk limits — "
        "consider hedging or reducing position size."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Risk decomposition
# ---------------------------------------------------------------------------


def risk_decomposition(
    positions: dict[str, float],        # symbol → notional value
    annualized_vols: dict[str, float],  # symbol → annualized σ
    correlation_matrix: Optional[dict[str, dict[str, float]]] = None,
) -> str:
    """Decompose portfolio risk into per-position contributions.

    Marginal / component VaR decomposition using simple variance-covariance.
    """
    if not positions:
        return "Risk Decomposition: No open positions."

    symbols = list(positions.keys())
    total_value = sum(positions.values())
    if total_value <= 0:
        return "Risk Decomposition: Zero portfolio value."

    weights = {s: positions[s] / total_value for s in symbols}

    # Build covariance matrix
    n = len(symbols)
    if n == 1:
        s = symbols[0]
        vol = annualized_vols.get(s, 0.3)
        contribution = weights[s] * vol
        return (
            f"Risk Decomposition\n{'=' * 40}\n"
            f"Single position: {s}\n"
            f"Annualized σ: {vol:.1%}\n"
            f"Risk contribution: {contribution:.1%} of portfolio vol\n"
            f"Portfolio annualized σ: {vol * abs(weights[s]):.1%}"
        )

    cov = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            vi = annualized_vols.get(symbols[i], 0.3)
            vj = annualized_vols.get(symbols[j], 0.3)
            if i == j:
                cov[i, j] = vi * vi
            elif correlation_matrix:
                rho = correlation_matrix.get(symbols[i], {}).get(symbols[j])
                if rho is not None:
                    cov[i, j] = rho * vi * vj
                else:
                    cov[i, j] = 0.5 * vi * vj  # default 0.5 correlation
            else:
                cov[i, j] = 0.5 * vi * vj

    w = np.array([weights[s] for s in symbols])
    port_var = float(w.T @ cov @ w)
    port_vol = float(math.sqrt(port_var))

    # Marginal risk contribution
    mctr = cov @ w / port_vol if port_vol > 0 else np.zeros(n)
    component_var = w * mctr  # component VaR contributions
    risk_pct = component_var / port_vol if port_vol > 0 else np.zeros(n)

    lines = [
        "Portfolio Risk Decomposition",
        "=" * 50,
        f"Portfolio Annualized σ: {port_vol:.1%}",
        f"Portfolio VaR (95%, 1d): {port_vol / math.sqrt(252) * 1.645:.1%}",
        "",
        f"{'Symbol':<12s} {'Weight':>8s} {'σ_annual':>10s} {'Risk Contrib':>12s} {'% of Risk':>10s}",
        "-" * 54,
    ]

    for i, s in enumerate(symbols):
        lines.append(
            f"{s:<12s} "
            f"{weights[s]:>7.1%} "
            f"{annualized_vols.get(s, 0.3):>9.1%} "
            f"{component_var[i]:>11.3%} "
            f"{risk_pct[i]:>9.1%}"
        )

    lines.append("")
    lines.append("Highest risk contributor(s):")
    sorted_idx = np.argsort(-risk_pct)
    for i in sorted_idx[:3]:
        if risk_pct[i] > 0.01:
            lines.append(f"  {symbols[i]}: {risk_pct[i]:.0%} of portfolio risk")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Fetch price history helper (for compute_annualized_volatility, etc.)
# ---------------------------------------------------------------------------


def _fetch_price_series(
    symbol: str, lookback_days: int = 90, asset_class: str = "crypto"
) -> Optional[list[float]]:
    """Fetch closing price series for a symbol.

    Returns list of close prices, oldest first.
    """
    try:
        from tradingagents.dataflows.interface import route_to_vendor

        end = datetime.now()
        start = end - timedelta(days=lookback_days)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        raw = route_to_vendor("get_crypto_ohlcv", symbol, start_str, end_str)

        df = pd.read_csv(StringIO(raw), index_col=0, parse_dates=True)
        if "Close" not in df.columns or df.empty:
            return None
        return df["Close"].astype(float).tolist()
    except Exception as e:
        logger.debug("Price fetch failed for %s: %s", symbol, e)
        return None
