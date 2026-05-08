"""Multi-asset portfolio optimization — capital allocation, rebalancing, risk parity.

Designed to be called after running the graph on multiple tickers.  Reads the
current portfolio state and produces an allocation proposal that the Portfolio
Manager can review.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from tradingagents.graph.planning import planning_config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class AllocationTarget:
    """A single allocation recommendation."""
    symbol: str
    current_weight: float   # fraction of portfolio
    target_weight: float    # fraction of portfolio
    delta: float            # target - current (positive = buy, negative = sell)
    rating: str             # one of Buy, Overweight, Hold, Underweight, Sell
    rationale: str


@dataclass
class OptimizationResult:
    """Complete portfolio optimization output."""
    allocations: list[AllocationTarget]
    expected_return: float
    expected_volatility: float
    diversification_ratio: float
    total_turnover: float  # sum of |delta| across all assets
    method: str
    summary: str


# ---------------------------------------------------------------------------
# Portfolio Optimizer
# ---------------------------------------------------------------------------


class PortfolioOptimizer:
    """Produces allocation suggestions across multiple assets.

    Config keys on merged ``planning.optimizer``:

    - ``method``: "equal_weight", "risk_parity", "rating_weighted"
    - ``max_turnover``: max % of portfolio to rebalance per run (e.g. 0.20)
    - ``min_position_pct``: minimum allocation per position (e.g. 0.05)
    """

    def __init__(self, config: dict):
        opt_cfg = planning_config(config).get("optimizer", {})
        self.method = opt_cfg.get("method", "rating_weighted")
        self.max_turnover = float(opt_cfg.get("max_turnover", 0.20))
        self.min_position_pct = float(opt_cfg.get("min_position_pct", 0.05))

    def optimize(
        self,
        portfolio_value: float,
        positions: dict[str, dict],  # symbol → {weight, rating, volatility?, ...}
        cash_weight: float = 0.0,
    ) -> OptimizationResult:
        """Generate allocation targets for all tracked assets.

        Parameters
        ----------
        portfolio_value : Total portfolio value in quote currency.
        positions : dict mapping symbol → metadata:
            - ``weight`` (float): current % of portfolio
            - ``rating`` (str): Buy/Overweight/Hold/Underweight/Sell
            - ``volatility`` (float, optional): annualized σ
        cash_weight : Current cash weight (0-1).

        Returns
        -------
        OptimizationResult with per-symbol allocation targets.
        """
        if not positions:
            return OptimizationResult(
                allocations=[], expected_return=0.0, expected_volatility=0.0,
                diversification_ratio=1.0, total_turnover=0.0, method="none",
                summary="No positions to optimize.",
            )

        if self.method == "equal_weight":
            targets = self._equal_weight(positions, cash_weight)
        elif self.method == "risk_parity":
            targets = self._risk_parity(positions, cash_weight)
        elif self.method == "rating_weighted":
            targets = self._rating_weighted(positions, cash_weight)
        else:
            targets = self._rating_weighted(positions, cash_weight)

        # Enforce turnover limit
        total_delta = sum(abs(t.delta) for t in targets) / 2.0
        if total_delta > self.max_turnover:
            scale = self.max_turnover / total_delta if total_delta > 0 else 1.0
            for t in targets:
                t.delta *= scale
                t.target_weight = t.current_weight + t.delta

        # Compute portfolio metrics
        exp_return = self._estimate_return(targets)
        exp_vol = self._estimate_portfolio_vol(targets, positions)
        div_ratio = self._diversification_ratio(positions)

        # Build summary
        summary_lines = [f"Portfolio Optimization ({self.method})", "=" * 45]
        for t in targets:
            action = "↑ BUY" if t.delta > 0.005 else ("↓ SELL" if t.delta < -0.005 else "─ HOLD")
            summary_lines.append(
                f"  {action:8s} {t.symbol:12s} "
                f"{t.current_weight:.1%} → {t.target_weight:.1%} "
                f"({t.rating})"
            )
        if not targets:
            summary_lines.append("  No positions to rebalance.")

        summary_lines.extend([
            "",
            f"  Expected Return:  {exp_return:+.1%}",
            f"  Expected Vol:     {exp_vol:.1%}",
            f"  Diversification:  {div_ratio:.1f}x",
            f"  Total Turnover:   {total_delta:.1%}",
        ])

        return OptimizationResult(
            allocations=targets,
            expected_return=exp_return,
            expected_volatility=exp_vol,
            diversification_ratio=div_ratio,
            total_turnover=total_delta,
            method=self.method,
            summary="\n".join(summary_lines),
        )

    # -- Methods ---------------------------------------------------------------

    def _equal_weight(
        self, positions: dict, cash_weight: float
    ) -> list[AllocationTarget]:
        n = len(positions)
        if n == 0:
            return []
        target_w = (1.0 - cash_weight) / n
        results = []
        for sym, data in positions.items():
            current = data["weight"]
            results.append(AllocationTarget(
                symbol=sym, current_weight=current, target_weight=target_w,
                delta=target_w - current, rating="Hold",
                rationale=f"Equal weight: each of {n} assets at {target_w:.1%}",
            ))
        return results

    def _risk_parity(
        self, positions: dict, cash_weight: float
    ) -> list[AllocationTarget]:
        """Allocate inversely proportional to volatility.

        w_i = (1/σ_i) / Σ(1/σ_j)  — so lower-vol assets get higher weight.
        """
        if not positions:
            return []

        vols = {}
        for sym, data in positions.items():
            vol = data.get("volatility", 0.3)  # default 30% annual
            vols[sym] = max(vol, 0.05)  # floor at 5%

        inv_vol_sum = sum(1.0 / v for v in vols.values())

        results = []
        for sym, data in positions.items():
            raw_w = (1.0 / vols[sym]) / inv_vol_sum
            target = raw_w * (1.0 - cash_weight)
            current = data["weight"]
            results.append(AllocationTarget(
                symbol=sym, current_weight=current, target_weight=target,
                delta=target - current, rating="Hold",
                rationale=f"Risk parity: σ={vols[sym]:.0%}, target={target:.1%}",
            ))
        return results

    def _rating_weighted(
        self, positions: dict, cash_weight: float
    ) -> list[AllocationTarget]:
        """Weight by rating: Buy=2.0, Overweight=1.5, Hold=1.0,
        Underweight=0.5, Sell=0.0 (normalized to sum to 1).
        """
        if not positions:
            return []

        rating_mult = {
            "buy": 2.0, "overweight": 1.5, "hold": 1.0,
            "underweight": 0.5, "sell": 0.1,
        }

        raw_scores = {}
        for sym, data in positions.items():
            r = data.get("rating", "hold").lower()
            raw_scores[sym] = rating_mult.get(r, 1.0)

        total = sum(raw_scores.values())
        if total == 0:
            return []

        results = []
        for sym, data in positions.items():
            target = (raw_scores[sym] / total) * (1.0 - cash_weight)
            current = data["weight"]
            results.append(AllocationTarget(
                symbol=sym, current_weight=current, target_weight=target,
                delta=target - current, rating=data.get("rating", "Hold"),
                rationale=(
                    f"Rating-weighted: {data.get('rating', 'Hold')} "
                    f"→ score={raw_scores[sym]:.1f}, target={target:.1%}"
                ),
            ))
        return results

    # -- Portfolio-level estimates ---------------------------------------------

    def _estimate_return(self, targets: list[AllocationTarget]) -> float:
        """Crude expected return estimate based on rating.

        Buy=+20% annual, Overweight=+10%, Hold=+5%, Underweight=-5%, Sell=-15%.
        """
        rating_er = {
            "buy": 0.20, "overweight": 0.10, "hold": 0.05,
            "underweight": -0.05, "sell": -0.15,
        }
        er = 0.0
        for t in targets:
            er += t.target_weight * rating_er.get(t.rating.lower(), 0.05)
        return er

    def _estimate_portfolio_vol(
        self, targets: list[AllocationTarget], positions: dict
    ) -> float:
        """Estimate portfolio volatility from position vols and simple correlation."""
        if len(targets) < 2:
            return positions.get(targets[0].symbol, {}).get("volatility", 0.3) if targets else 0.0

        vols = np.array([
            positions.get(t.symbol, {}).get("volatility", 0.3)
            for t in targets
        ])
        w = np.array([t.target_weight for t in targets])

        # Simplification: assume 0.5 average correlation
        rho = 0.5
        n = len(w)
        cov = np.outer(vols, vols) * rho
        np.fill_diagonal(cov, vols ** 2)

        port_var = float(w.T @ cov @ w)
        return float(math.sqrt(port_var))

    def _diversification_ratio(self, positions: dict) -> float:
        """Ratio of weighted-average vol to portfolio vol (= 1 if perfectly correlated)."""
        if len(positions) < 2:
            return 1.0

        vols = [p.get("volatility", 0.3) for p in positions.values()]
        weights = [p.get("weight", 1.0 / len(positions)) for p in positions.values()]
        weighted_avg_vol = sum(w * v for w, v in zip(weights, vols))
        port_vol = math.sqrt(
            sum((w * v) ** 2 for w, v in zip(weights, vols))
        )
        if port_vol < 0.0001:
            return 1.0
        return weighted_avg_vol / port_vol


# ---------------------------------------------------------------------------
# Rebalancing runner
# ---------------------------------------------------------------------------


def generate_rebalance_report(
    portfolio_value: float,
    positions: dict[str, dict],
    config: dict,
    cash_weight: float = 0.0,
) -> str:
    """One-shot rebalancing report: instantiate optimizer and return
    the formatted summary string.

    Suitable for injecting into the Portfolio Manager's prompt context
    when the agent is evaluating multiple tickers simultaneously.
    """
    optimizer = PortfolioOptimizer(config)
    result = optimizer.optimize(portfolio_value, positions, cash_weight)
    return result.summary
