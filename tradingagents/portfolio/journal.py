"""Trade journal — persistent record of filled orders and P&L."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from tradingagents.exchange.base import Order

logger = logging.getLogger(__name__)


class TradeJournal:
    """Records every filled trade and computes performance metrics.

    Persisted as a JSON array at ``data_cache_dir / journal.json``.
    """

    def __init__(self, config: dict):
        cache_dir = config.get("data_cache_dir", ".")
        self._path = Path(cache_dir) / "trade_journal.json"
        self._trades: list[dict] = []
        self._load()

    # -- Persistence -----------------------------------------------------------

    def _load(self) -> None:
        if self._path.exists():
            try:
                self._trades = json.loads(self._path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Could not load trade journal: %s", e)
                self._trades = []

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._trades, indent=2, default=str), encoding="utf-8")
        tmp.replace(self._path)

    # -- Record trades ---------------------------------------------------------

    def record_fill(self, order: Order) -> str:
        """Record a filled order. Returns the trade id."""
        trade_id = str(uuid.uuid4())[:12]
        self._trades.append({
            "trade_id": trade_id,
            "order_id": order.id,
            "symbol": order.symbol,
            "side": order.side,
            "amount": order.filled,
            "price": order.avg_price,
            "cost": order.cost,
            "fee": order.fee,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        self._save()
        return trade_id

    def record_close(
        self,
        symbol: str,
        side: str,
        amount: float,
        entry_price: float,
        exit_price: float,
        realized_pnl: float,
        fee: float = 0.0,
    ) -> str:
        """Record a closing trade with P&L."""
        trade_id = str(uuid.uuid4())[:12]
        self._trades.append({
            "trade_id": trade_id,
            "symbol": symbol,
            "side": side,
            "amount": amount,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "realized_pnl": realized_pnl,
            "fee": fee,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        self._save()
        return trade_id

    # -- Read ---------------------------------------------------------------

    def get_recent_trades(self, symbol: str = "", n: int = 10) -> list[dict]:
        """Return the most recent N trades, optionally filtered by symbol."""
        filtered = self._trades
        if symbol:
            filtered = [t for t in filtered if t.get("symbol") == symbol]
        return filtered[-n:]

    def get_total_pnl(self) -> float:
        """Sum of all realized P&L."""
        return sum(
            t.get("realized_pnl", 0.0)
            for t in self._trades
        )

    def get_win_rate(self) -> float:
        """Fraction of profitable trades (among trades with realized_pnl)."""
        closed = [t for t in self._trades if t.get("realized_pnl") is not None]
        if not closed:
            return 0.0
        wins = sum(1 for t in closed if t["realized_pnl"] > 0)
        return wins / len(closed)

    def get_total_trades(self) -> int:
        return len(self._trades)

    def to_context_str(self, n: int = 5) -> str:
        """Recent trade context for LLM prompt injection."""
        recent = self.get_recent_trades(n=n)
        if not recent:
            return "No trades recorded yet."
        lines = [f"Recent Trades (last {len(recent)}):"]
        for t in reversed(recent):
            symbol = t.get("symbol", "?")
            side = t.get("side", "?")
            amount = t.get("amount", 0)
            price = t.get("price") or t.get("exit_price") or 0
            pnl = t.get("realized_pnl")
            if pnl is not None:
                lines.append(
                    f"  {symbol} {side} {amount} @ ${price:.4f} | "
                    f"P&L: {pnl:+.2f}"
                )
            else:
                lines.append(f"  {symbol} {side} {amount} @ ${price:.4f}")
        total_pnl = self.get_total_pnl()
        win_rate = self.get_win_rate()
        lines.append(f"Total P&L: {total_pnl:+.2f} | Win Rate: {win_rate:.1%} ({self.get_total_trades()} trades)")
        return "\n".join(lines)
