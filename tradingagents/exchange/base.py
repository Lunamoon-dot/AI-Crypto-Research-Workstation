"""Exchange adapter abstract base and shared data models."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class Balance:
    """Account balance snapshot."""

    free: dict[str, float]  # available cash per currency
    used: dict[str, float]  # locked/margin cash per currency
    total: dict[str, float]  # free + used per currency

    def quote_free(self, quote: str = "USDT") -> float:
        return self.free.get(quote, 0.0)


@dataclass
class ExchangePosition:
    """Exchange-view of an open position (used for syncing)."""

    symbol: str
    side: str  # "long" or "short"
    amount: float
    entry_price: float
    leverage: int = 1
    unrealized_pnl: float = 0.0
    liquidation_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@dataclass
class Order:
    """An order placed on (or simulated by) an exchange."""

    id: str
    symbol: str
    side: str  # "buy" or "sell"
    type: str  # "market", "limit", "stop", "stop_limit"
    amount: float
    price: Optional[float] = None  # limit/stop price (None for market)
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    status: str = "open"  # pending/open/closed/canceled/rejected
    filled: float = 0.0
    remaining: float = 0.0
    avg_price: Optional[float] = None  # average fill price
    cost: float = 0.0
    fee: float = 0.0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def is_done(self) -> bool:
        return self.status in ("closed", "canceled", "rejected")


# ---------------------------------------------------------------------------
# Abstract adapter
# ---------------------------------------------------------------------------


class ExchangeAdapter(ABC):
    """Unified interface for both real (CCXT) and paper trading exchanges."""

    def __init__(self, config: dict):
        self.config = config

    # -- Account ---------------------------------------------------------------

    @abstractmethod
    def get_balance(self) -> Balance:
        """Return current account balance."""

    @abstractmethod
    def get_positions(self) -> list[ExchangePosition]:
        """Return all currently open positions."""

    # -- Order lifecycle -------------------------------------------------------

    @abstractmethod
    def place_order(
        self,
        symbol: str,
        side: str,
        amount: float,
        order_type: str = "market",
        price: Optional[float] = None,
        *,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        leverage: Optional[int] = None,
        reduce_only: bool = False,
    ) -> Order:
        """Place an order. Returns the order with id."""

    @abstractmethod
    def cancel_order(self, order_id: str, symbol: str = "") -> bool:
        """Cancel an open order."""

    @abstractmethod
    def get_order(self, order_id: str, symbol: str = "") -> Order:
        """Fetch a single order by id."""

    @abstractmethod
    def get_open_orders(self, symbol: str = "") -> list[Order]:
        """Fetch all currently open orders."""

    # -- Market data -----------------------------------------------------------

    @abstractmethod
    def fetch_ticker(self, symbol: str) -> dict:
        """Fetch latest price data. Returns dict with keys: last, bid, ask, high, low, volume."""

    # -- Trade history ---------------------------------------------------------

    @abstractmethod
    def fetch_trade_history(self, symbol: str = "", limit: int = 50) -> list[dict]:
        """Fetch recent filled trades from the exchange.

        Returns list of dicts with keys:
        id, symbol, side, amount, price, cost, fee, timestamp, realized_pnl
        """

    # -- Futures helpers -------------------------------------------------------

    @abstractmethod
    def set_leverage(self, symbol: str, leverage: int) -> None:
        """Set leverage for a futures position."""

    @abstractmethod
    def normalize_symbol(self, symbol: str) -> str:
        """Convert user-facing symbol to exchange-native format."""
