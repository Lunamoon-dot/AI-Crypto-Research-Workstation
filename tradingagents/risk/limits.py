"""Risk limits — pre-trade checks that block dangerous orders."""

from __future__ import annotations

import logging
from typing import Optional

from tradingagents.portfolio.portfolio import Portfolio

logger = logging.getLogger(__name__)


class RiskLimits:
    """Enforces portfolio-level risk constraints before order execution.

    Config keys (under ``execution.risk_limits``):

    - ``max_position_size_pct``: Max % of portfolio in a single position (e.g. 30).
    - ``max_leverage``: Maximum allowed leverage (futures only).
    - ``max_drawdown_pct``: Stop trading if drawdown exceeds this.
    - ``max_open_positions``: Max number of concurrent positions.

    All checks return ``(passed: bool, reason: str)`` — when ``passed`` is
    False, the order should be rejected.
    """

    def __init__(self, config: dict):
        rl = config.get("execution", {}).get("risk_limits", {})
        self.max_position_size_pct: float = float(rl.get("max_position_size_pct", 30.0))
        self.max_leverage: int = int(rl.get("max_leverage", 3))
        self.max_drawdown_pct: float = float(rl.get("max_drawdown_pct", 15.0))
        self.max_open_positions: int = int(rl.get("max_open_positions", 5))

    def check(
        self,
        rating: str,
        symbol: str,
        amount: float,
        price: float,
        side: str,
        *,
        leverage: int = 1,
        portfolio: Portfolio,
        sizing_pct: float = 0.0,
    ) -> tuple[bool, str]:
        """Run all risk checks. Returns (passed, reason)."""

        # -- Drawdown halt ------------------------------------------------------
        dd = portfolio.drawdown_pct
        if dd > self.max_drawdown_pct / 100.0:
            return False, (
                f"Portfolio drawdown {dd:.1%} exceeds limit "
                f"{self.max_drawdown_pct:.1%}. Trading halted."
            )

        # -- Max open positions -------------------------------------------------
        if portfolio.position_count() >= self.max_open_positions and side == "buy":
            existing = symbol in portfolio.positions
            if not existing:
                return False, (
                    f"Maximum open positions ({self.max_open_positions}) reached. "
                    f"Cannot open new position for {symbol}."
                )

        # -- Leverage ----------------------------------------------------------
        if leverage > self.max_leverage:
            return False, (
                f"Requested leverage {leverage}x exceeds max {self.max_leverage}x."
            )

        # -- Position size ------------------------------------------------------
        total_value = portfolio.total_value
        if symbol in portfolio.positions:
            pos = portfolio.positions[symbol]
            proposed_exposure = ((pos.amount + amount) * price * leverage) / total_value
        else:
            proposed_exposure = (amount * price * leverage) / total_value

        if proposed_exposure > self.max_position_size_pct / 100.0:
            return False, (
                f"Proposed exposure {proposed_exposure:.1%} for {symbol} exceeds "
                f"max position size {self.max_position_size_pct:.0f}%."
            )

        # -- Sufficient balance -------------------------------------------------
        if not portfolio.can_open_position(symbol, amount, price, leverage):
            return False, (
                f"Insufficient {portfolio.quote_currency} balance for "
                f"{amount} {symbol} at ${price:.4f}."
            )

        return True, "All risk checks passed."
