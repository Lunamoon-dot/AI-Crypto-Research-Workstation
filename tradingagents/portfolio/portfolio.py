"""Portfolio tracking — internal view of capital and positions."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from tradingagents.exchange.base import ExchangeAdapter, ExchangePosition

logger = logging.getLogger(__name__)


@dataclass
class Position:
    """Our internal tracking of an open position."""

    symbol: str
    side: str  # "long" or "short"
    amount: float
    entry_price: float
    leverage: int = 1
    current_price: float = 0.0
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    opened_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def value(self) -> float:
        """Current notional value of the position."""
        return self.amount * self.current_price * self.leverage

    def to_context_str(self) -> str:
        """Compact one-line summary for LLM prompt injection."""
        direction = "LONG" if self.side == "long" else "SHORT"
        pnl_sign = "+" if self.unrealized_pnl >= 0 else ""
        return (
            f"{direction} {self.symbol} | "
            f"Size: {self.amount:.4f} | "
            f"Entry: ${self.entry_price:.4f} | "
            f"Current: ${self.current_price:.4f} | "
            f"PnL: {pnl_sign}{self.unrealized_pnl:.2f} ({pnl_sign}{self.unrealized_pnl_pct:.1%}) | "
            f"Lev: {self.leverage}x"
        )


class Portfolio:
    """Tracks capital, positions, and updates from exchange."""

    def __init__(
        self,
        exchange: ExchangeAdapter,
        quote_currency: str = "USDT",
    ):
        self.exchange = exchange
        self.quote_currency = quote_currency
        self.cash: dict[str, float] = {}
        self.positions: dict[str, Position] = {}
        self._initial_capital: float = 0.0
        self._peak_value: float = 0.0
        self._last_quote_price: float = 0.0  # last price used for P&L calc

        # Load initial state from exchange
        self.update()

    def update(self) -> None:
        """Sync with exchange: fetch balance and positions."""
        # Balance
        bal = self.exchange.get_balance()
        self.cash = dict(bal.free)
        if self._initial_capital == 0.0:
            quote_total = bal.total.get(self.quote_currency, 0.0)
            self._initial_capital = quote_total
            self._peak_value = quote_total

        # Positions
        raw_positions = self.exchange.get_positions()
        existing_symbols = set(self.positions)

        for rp in raw_positions:
            # Get current price
            try:
                ticker = self.exchange.fetch_ticker(rp.symbol)
                current_price = float(ticker.get("last") or rp.entry_price)
            except Exception:
                current_price = rp.entry_price
            self._last_quote_price = current_price

            upnl = rp.unrealized_pnl
            upnl_pct = (current_price - rp.entry_price) / rp.entry_price if rp.entry_price else 0.0
            if rp.side == "short":
                upnl_pct = (rp.entry_price - current_price) / rp.entry_price if rp.entry_price else 0.0

            if rp.symbol in self.positions:
                self.positions[rp.symbol].amount = rp.amount
                self.positions[rp.symbol].entry_price = rp.entry_price
                self.positions[rp.symbol].current_price = current_price
                self.positions[rp.symbol].unrealized_pnl = upnl
                self.positions[rp.symbol].unrealized_pnl_pct = upnl_pct
                self.positions[rp.symbol].leverage = rp.leverage
                self.positions[rp.symbol].stop_loss = rp.stop_loss
                self.positions[rp.symbol].take_profit = rp.take_profit
                self.positions[rp.symbol].updated_at = datetime.now(timezone.utc).isoformat()
            else:
                self.positions[rp.symbol] = Position(
                    symbol=rp.symbol,
                    side=rp.side,
                    amount=rp.amount,
                    entry_price=rp.entry_price,
                    leverage=rp.leverage,
                    current_price=current_price,
                    unrealized_pnl=upnl,
                    unrealized_pnl_pct=upnl_pct,
                    stop_loss=rp.stop_loss,
                    take_profit=rp.take_profit,
                )
            existing_symbols.discard(rp.symbol)

        # Remove positions that no longer exist on exchange
        for stale in existing_symbols:
            del self.positions[stale]

        # Track peak value
        current_value = self.total_value
        if current_value > self._peak_value:
            self._peak_value = current_value

    @property
    def total_value(self) -> float:
        """Total portfolio value in quote currency."""
        quote_cash = self.cash.get(self.quote_currency, 0.0)
        # Add position values approximated via unrealized P&L
        position_value = sum(
            p.unrealized_pnl + (p.amount * p.entry_price * p.leverage)
            for p in self.positions.values()
        )
        return quote_cash + position_value

    @property
    def drawdown_pct(self) -> float:
        """Current drawdown from peak as %."""
        if self._peak_value <= 0:
            return 0.0
        return (self._peak_value - self.total_value) / self._peak_value

    def can_open_position(
        self, symbol: str, amount: float, price: float, leverage: int = 1
    ) -> bool:
        """Check if there is enough free margin to open a position."""
        required = amount * price / leverage
        quote_free = self.cash.get(self.quote_currency, 0.0)
        return quote_free >= required

    def position_count(self) -> int:
        return len(self.positions)

    def exposure_pct(self, symbol: str) -> float:
        """What % of portfolio is allocated to a given symbol."""
        if self.total_value <= 0:
            return 0.0
        pos = self.positions.get(symbol)
        if pos is None:
            return 0.0
        return (pos.amount * pos.current_price * pos.leverage) / self.total_value

    def to_context_str(self) -> str:
        """Generate a concise portfolio snapshot for LLM prompt injection."""
        lines = [
            f"Portfolio Snapshot:",
            f"  Cash ({self.quote_currency}): ${self.cash.get(self.quote_currency, 0.0):,.2f}",
            f"  Total Value: ${self.total_value:,.2f}",
            f"  Drawdown from Peak: {self.drawdown_pct:.1%}",
            f"  Open Positions: {len(self.positions)}",
        ]
        if self.positions:
            lines.append("  --- Positions ---")
            for pos in self.positions.values():
                lines.append(f"  {pos.to_context_str()}")
        return "\n".join(lines)
