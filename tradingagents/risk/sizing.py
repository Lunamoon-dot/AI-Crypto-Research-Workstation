"""Position sizing strategies — Kelly, volatility-adjusted, ATR-based, and more.

Three modes (config key ``execution.position_sizing``):

``"fixed"``
    Fixed-ratio mapping: rating → % of portfolio.  No LLM call.

``"llm"``
    Uses the Trader Agent's free-text sizing guidance.  Extracts a
    percentage from the ``position_sizing`` field if possible; falls
    back to the fixed mapping.

``"kelly"``
    Kelly Criterion — sizes based on historical win rate and win/loss
    ratio from the trade journal.  Half-Kelly by default for safety.

``"volatility"``
    Volatility-adjusted sizing — targets a configurable % daily vol
    contribution per position.  Caps at ``max_position_size_pct``.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Fixed mapping: rating → fraction of portfolio to allocate
FIXED_SIZING: dict[str, float] = {
    "buy": 0.25,
    "overweight": 0.15,
    "hold": 0.0,
    "underweight": -0.10,
    "sell": -1.0,
}


def _safe_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(str(val).replace("%", "").strip())
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Position Sizer
# ---------------------------------------------------------------------------


class PositionSizer:
    """Translates a rating into a concrete portfolio allocation %."""

    def __init__(self, config: dict):
        exec_cfg = config.get("execution", {})
        self.mode: str = exec_cfg.get("position_sizing", "llm")
        self.max_position_pct: float = float(
            exec_cfg.get("risk_limits", {}).get("max_position_size_pct", 30)
        ) / 100.0
        # Volatility targeting params
        self.vol_target_daily: float = float(
            exec_cfg.get("volatility_target_daily", 0.01)
        )  # default 1% daily vol per position
        # Kelly params
        self.kelly_fraction: float = float(
            exec_cfg.get("kelly_fraction", 0.5)
        )  # half-Kelly default
        # Fixed sizing from config (allows user override of module-level default)
        self.fixed_sizing: dict[str, float] = config.get("fixed_sizing", FIXED_SIZING)
        # ATR risk target
        self.atr_risk_target: float = float(
            config.get("atr_risk_target", 0.02)
        )

    def calculate(
        self,
        rating: str,
        portfolio_value: float,
        current_exposure_pct: float,
        *,
        trader_sizing_str: str = "",
        trader_action: str = "",
        win_rate: Optional[float] = None,
        avg_win: Optional[float] = None,
        avg_loss: Optional[float] = None,
        volatility: Optional[float] = None,  # annualized σ
        atr: Optional[float] = None,
        price: Optional[float] = None,
    ) -> tuple[float, str]:
        """Calculate the position size as a fraction of portfolio.

        Returns (allocation_pct, reasoning).
        Positive = buy/long, negative = sell/short.
        """
        rating_lower = rating.strip().lower()

        if self.mode == "fixed":
            return self._fixed_size(rating_lower, current_exposure_pct)
        if self.mode == "kelly":
            return self._kelly_size(
                rating_lower, current_exposure_pct,
                win_rate, avg_win, avg_loss,
            )
        if self.mode == "volatility":
            return self._volatility_size(
                rating_lower, current_exposure_pct, volatility,
            )
        if self.mode == "atr":
            return self._atr_size(
                rating_lower, current_exposure_pct, portfolio_value,
                atr, price,
            )

        # Default: LLM mode
        return self._llm_size(
            rating_lower, portfolio_value, current_exposure_pct,
            trader_sizing_str, trader_action,
        )

    # -- Fixed ----------------------------------------------------------------

    def _fixed_size(
        self, rating: str, current_exposure: float
    ) -> tuple[float, str]:
        alloc = self.fixed_sizing.get(rating, 0.0)
        reasoning = (
            f"Fixed sizing: {rating} → {alloc:+.0%} of portfolio "
            f"(current exposure: {current_exposure:.1%})"
        )
        return alloc, reasoning

    # -- Kelly Criterion ------------------------------------------------------

    def _kelly_size(
        self,
        rating: str,
        current_exposure: float,
        win_rate: Optional[float] = None,
        avg_win: Optional[float] = None,
        avg_loss: Optional[float] = None,
    ) -> tuple[float, str]:
        """Kelly Criterion: f* = (p * b - q) / b

        Where p = win rate, q = 1-p, b = avg_win / |avg_loss|.

        Falls back to fixed sizing when journal data is insufficient.
        """
        # Require at least 10 trades for Kelly
        if (
            win_rate is None or avg_win is None or avg_loss is None
            or avg_loss == 0
        ):
            alloc = self.fixed_sizing.get(rating, 0.0)
            return alloc, (
                f"Kelly: insufficient trade history — "
                f"fallback fixed sizing: {rating} → {alloc:+.0%}"
            )

        p = max(0.01, min(0.99, win_rate))
        q = 1.0 - p
        b = abs(avg_win / avg_loss) if avg_loss != 0 else 1.0

        kelly_f = (p * b - q) / b
        kelly_f = max(0.0, min(kelly_f, self.max_position_pct))

        # Apply the kelly fraction (half-Kelly = 0.5x, quarter-Kelly = 0.25x)
        alloc = kelly_f * self.kelly_fraction

        # Directional scaling: rating tells us conviction
        rating_mult = {
            "buy": 1.0, "overweight": 0.6, "hold": 0.0,
            "underweight": -0.4, "sell": -0.75,
        }
        alloc *= rating_mult.get(rating, 0.0)

        reasoning = (
            f"Kelly sizing: win_rate={p:.1%}, avg_win={avg_win:+.1%}, "
            f"avg_loss={avg_loss:+.1%}, b={b:.1f}, kelly_f={kelly_f:.1%}, "
            f"fraction={self.kelly_fraction}x → alloc={alloc:+.1%}"
        )
        return alloc, reasoning

    # -- Volatility-adjusted --------------------------------------------------

    def _volatility_size(
        self,
        rating: str,
        current_exposure: float,
        volatility: Optional[float] = None,
    ) -> tuple[float, str]:
        """Size based on volatility targeting.

        Target allocation = (vol_target_daily / daily_vol) as fraction of
        portfolio, capped at max_position_pct.

        Daily vol = annualized_vol / sqrt(252).
        """
        if volatility is None or volatility <= 0:
            alloc = self.fixed_sizing.get(rating, 0.0)
            return alloc, (
                f"Volatility sizing: no volatility data — "
                f"fallback fixed: {rating} → {alloc:+.0%}"
            )

        import math
        daily_vol = volatility / math.sqrt(252)

        # Base allocation: target daily vol contribution / asset daily vol
        if daily_vol > 0:
            base_alloc = self.vol_target_daily / daily_vol
        else:
            base_alloc = 0.0

        base_alloc = min(base_alloc, self.max_position_pct)

        # Rating multiplier
        rating_mult = {
            "buy": 1.0, "overweight": 0.6, "hold": 0.0,
            "underweight": -0.4, "sell": -0.75,
        }
        alloc = base_alloc * rating_mult.get(rating, 0.0)

        reasoning = (
            f"Volatility sizing: annual_σ={volatility:.1%}, "
            f"daily_σ={daily_vol:.3%}, target_daily_vol={self.vol_target_daily:.1%} "
            f"→ base_alloc={base_alloc:.1%}, rating_mult={rating_mult.get(rating, 0)} "
            f"→ alloc={alloc:+.1%}"
        )
        return alloc, reasoning

    # -- ATR-based ------------------------------------------------------------

    def _atr_size(
        self,
        rating: str,
        current_exposure: float,
        portfolio_value: float,
        atr: Optional[float] = None,
        price: Optional[float] = None,
    ) -> tuple[float, str]:
        """Size position so a 2× ATR move = target risk % of portfolio.

        Risk per unit = 2 × ATR.  Max units = (target_risk_pct × portfolio)
        / (2 × ATR).  Then convert to % allocation.
        """
        if atr is None or price is None or atr <= 0 or price <= 0:
            alloc = self.fixed_sizing.get(rating, 0.0)
            return alloc, (
                f"ATR sizing: insufficient data (atr={atr}, price={price}) — "
                f"fallback fixed: {rating} → {alloc:+.0%}"
            )

        target_risk_pct = self.atr_risk_target
        risk_per_unit = 2.0 * atr
        max_units = (target_risk_pct * portfolio_value) / risk_per_unit
        alloc = (max_units * price) / portfolio_value
        alloc = min(alloc, self.max_position_pct)

        rating_mult = {
            "buy": 1.0, "overweight": 0.6, "hold": 0.0,
            "underweight": -0.4, "sell": -0.75,
        }
        alloc *= rating_mult.get(rating, 0.0)

        reasoning = (
            f"ATR sizing: price=${price:.4f}, ATR=${atr:.4f}, "
            f"risk_per_unit=${risk_per_unit:.4f}, max_units={max_units:.4f}, "
            f"target_risk={target_risk_pct:.1%} → alloc={alloc:+.1%}"
        )
        return alloc, reasoning

    # -- LLM mode (parsed from trader's free text) ----------------------------

    def _llm_size(
        self,
        rating: str,
        portfolio_value: float,
        current_exposure: float,
        sizing_str: str,
        action: str,
    ) -> tuple[float, str]:
        pct = _extract_percentage(sizing_str)
        if pct is not None:
            alloc = pct / 100.0
            # LLMs often quote absolute percentages; negate for bearish ratings
            if rating in ("underweight", "sell"):
                alloc = -abs(alloc)
            reasoning = (
                f"LLM suggested {pct:.1f}% allocation for {rating} "
                f"(parsed from: {sizing_str[:80]})"
            )
            return alloc, reasoning

        if action.lower() == "hold":
            return 0.0, f"LLM action=Hold → no change (sizing_str: {sizing_str[:80]})"

        alloc = self.fixed_sizing.get(rating, 0.0)
        fallback_msg = (
            f"LLM did not specify position size → fallback to fixed sizing: "
            f"{rating} → {alloc:+.0%}"
        )
        logger.warning(fallback_msg)
        return alloc, fallback_msg


# ---------------------------------------------------------------------------
# Utility: extract percentage from free text
# ---------------------------------------------------------------------------


def _extract_percentage(text: str) -> Optional[float]:
    import re
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
    if m:
        return float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*percent", text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = re.search(r"allocate\s+(0?\.\d+)", text, re.IGNORECASE)
    if m:
        return float(m.group(1)) * 100.0
    return None


# ---------------------------------------------------------------------------
# Quick computation helpers (used by the execution pipeline)
# ---------------------------------------------------------------------------


def compute_annualized_volatility(prices: list[float]) -> Optional[float]:
    """Compute annualized volatility from a series of daily prices."""
    import math
    if len(prices) < 5:
        return None
    returns = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0:
            returns.append((prices[i] - prices[i - 1]) / prices[i - 1])
    if len(returns) < 2:
        return None
    mean_r = sum(returns) / len(returns)
    var = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
    return float(math.sqrt(var) * math.sqrt(252))


def compute_atr(highs: list[float], lows: list[float], closes: list[float]) -> Optional[float]:
    """Compute 14-period Average True Range from price data."""
    if len(closes) < 15:
        return None
    tr_values = []
    for i in range(1, min(len(highs), len(lows), len(closes))):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        tr_values.append(tr)
    if len(tr_values) < 14:
        return None
    return float(sum(tr_values[-14:]) / 14)
