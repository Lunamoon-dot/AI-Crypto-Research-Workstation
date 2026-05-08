"""Paper trading adapter — simulated exchange for risk-free testing.

Fills at current market price (fetched via CCXT data-only endpoint) and
tracks positions + orders in memory.  Balance starts from a configurable
amount (default 10,000 USDT).

SL/TP monitoring is alert-only. It does not close positions automatically.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from tradingagents.exceptions import StaleDataError, StorageError
from tradingagents.observability import log_event

from .base import Balance, ExchangeAdapter, ExchangePosition, Order

logger = logging.getLogger(__name__)


class PaperAdapter(ExchangeAdapter):
    """Simulated exchange — no real money, no real API keys needed.

    State is persisted to disk so trades survive across runs and are
    visible in the dashboard.
    """

    def __init__(self, config: dict):
        super().__init__(config)
        exec_cfg = config.get("execution", {})
        self.initial_balance = float(exec_cfg.get("initial_balance", 10_000))
        self.market_type = exec_cfg.get("market_type", "spot")

        # Persistent state file
        cache_dir = config.get("data_cache_dir", ".")
        self._state_path = Path(cache_dir) / "paper_state.json"

        # In-memory state (defaults, will be overwritten by load if exists)
        self._free: dict[str, float] = {"USDT": self.initial_balance}
        self._used: dict[str, float] = {}
        self._positions: dict[str, ExchangePosition] = {}
        self._orders: dict[str, Order] = {}
        self._realized_pnl: float = 0.0

        # A CCXT exchange instance (read-only, no auth) for price data
        self._price_exchange = None

        # Load persisted state (overwrites defaults)
        self._load_state()

    # -- Persistence ---------------------------------------------------------

    def _load_state(self) -> None:
        """Load paper trading state from disk."""
        if not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            self._free = data.get("free", {"USDT": self.initial_balance})
            self._realized_pnl = data.get("realized_pnl", 0.0)
            # Restore positions
            self._positions = {}
            for sym, pos_data in data.get("positions", {}).items():
                self._positions[sym] = ExchangePosition(
                    symbol=pos_data["symbol"],
                    side=pos_data["side"],
                    amount=pos_data["amount"],
                    entry_price=pos_data["entry_price"],
                    leverage=pos_data.get("leverage", 1),
                    unrealized_pnl=pos_data.get("unrealized_pnl", 0.0),
                    liquidation_price=pos_data.get("liquidation_price"),
                    stop_loss=pos_data.get("stop_loss"),
                    take_profit=pos_data.get("take_profit"),
                )
            logger.info(
                "Loaded paper state: free=%s, %d positions, realized_pnl=%.2f",
                self._free, len(self._positions), self._realized_pnl,
            )
        except (json.JSONDecodeError, KeyError, OSError) as e:
            logger.warning("Could not load paper state: %s — starting fresh", e)

    def _save_state(self) -> None:
        """Save current paper trading state to disk."""
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        positions_data = {}
        for sym, pos in self._positions.items():
            positions_data[sym] = {
                "symbol": pos.symbol,
                "side": pos.side,
                "amount": pos.amount,
                "entry_price": pos.entry_price,
                "leverage": pos.leverage,
                "unrealized_pnl": pos.unrealized_pnl,
                "liquidation_price": pos.liquidation_price,
                "stop_loss": pos.stop_loss,
                "take_profit": pos.take_profit,
            }
        data = {
            "free": self._free,
            "realized_pnl": self._realized_pnl,
            "positions": positions_data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        tmp = self._state_path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            tmp.replace(self._state_path)
        except OSError as exc:
            raise StorageError(f"Failed to save paper state: {exc}") from exc

    # -- Price data ------------------------------------------------------------

    def _get_price_exchange(self):
        if self._price_exchange is not None:
            return self._price_exchange
        import ccxt

        exchange_id = self.config.get("execution", {}).get("exchange", "bitget")
        exchange_class = getattr(ccxt, exchange_id)
        self._price_exchange = exchange_class({"enableRateLimit": True})
        self._price_exchange.load_markets()
        return self._price_exchange

    def fetch_ticker(self, symbol: str) -> dict:
        """Fetch live market price from the underlying CCXT exchange (read-only)."""
        exchange = self._get_price_exchange()
        native_symbol = self.normalize_symbol(symbol)
        try:
            raw = exchange.fetch_ticker(native_symbol)
        except Exception as e:
            exchange_id = self.config.get("execution", {}).get("exchange", "bitget")
            msg = (
                f"Symbol {symbol} is not available on {exchange_id}. "
                f"Try a pair like BTC/USDT, ETH/USDT, or SOL/USDT that {exchange_id} supports."
            )
            raise RuntimeError(msg) from e
        return {
            "symbol": native_symbol,
            "last": raw.get("last"),
            "bid": raw.get("bid"),
            "ask": raw.get("ask"),
            "high": raw.get("high"),
            "low": raw.get("low"),
            "volume": raw.get("baseVolume") or raw.get("quoteVolume"),
            "change_pct": raw.get("percentage"),
            "timestamp": raw.get("datetime"),
        }

    def _get_last_price(self, symbol: str, market_data=None) -> float:
        """Get current price — cache-first when WebSocket feed is available."""
        stale_mode = self.config.get("stale_data", {}).get("mode", "warn")
        if market_data is not None:
            if market_data.is_ticker_stale(symbol):
                log_event(
                    logger,
                    "stale_data_detected",
                    source="websocket_ticker",
                    symbol=symbol,
                    age_hours=0.0,
                    mode=stale_mode,
                )
                if stale_mode == "fail_fast":
                    raise StaleDataError(
                        f"WebSocket ticker for {symbol} is stale; "
                        f"execution blocked in fail_fast mode"
                    )
            else:
                ticker = market_data.get_ticker(symbol)
                if ticker:
                    price = ticker.get("last")
                    if price:
                        return float(price)
        ticker = self.fetch_ticker(symbol)
        price = ticker.get("last")
        if price is None:
            raise ValueError(f"Cannot get price for {symbol}")
        return float(price)

    # -- Account ---------------------------------------------------------------

    def get_balance(self) -> Balance:
        total: dict[str, float] = {}
        all_keys = set(self._free) | set(self._used)
        for k in all_keys:
            total[k] = self._free.get(k, 0.0) + self._used.get(k, 0.0)
        return Balance(
            free=dict(self._free),
            used=dict(self._used),
            total=total,
        )

    def get_positions(self) -> list[ExchangePosition]:
        # Update unrealized P&L for each position
        result: list[ExchangePosition] = []
        for sym, pos in list(self._positions.items()):
            try:
                last = self._get_last_price(sym)
            except Exception:
                last = pos.entry_price
            upnl = (last - pos.entry_price) * pos.amount
            if pos.side == "short":
                upnl = (pos.entry_price - last) * pos.amount
            result.append(ExchangePosition(
                symbol=pos.symbol,
                side=pos.side,
                amount=pos.amount,
                entry_price=pos.entry_price,
                leverage=pos.leverage,
                unrealized_pnl=upnl,
                liquidation_price=pos.liquidation_price,
                stop_loss=pos.stop_loss,
                take_profit=pos.take_profit,
            ))
        return result

    # -- Order lifecycle -------------------------------------------------------

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
        native_symbol = self.normalize_symbol(symbol)
        order_id = str(uuid.uuid4())[:12]
        order = Order(
            id=order_id,
            symbol=native_symbol,
            side=side,
            type=order_type,
            amount=amount,
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            status="open",
            remaining=amount,
        )
        self._orders[order_id] = order
        self._simulate_fill(order)
        return self._orders[order_id]

    def cancel_order(self, order_id: str, symbol: str = "") -> bool:
        order = self._orders.get(order_id)
        if order and not order.is_done:
            order.status = "canceled"
            return True
        return False

    def get_order(self, order_id: str, symbol: str = "") -> Order:
        return self._orders.get(order_id, Order(
            id=order_id, symbol=symbol, side="", type="", amount=0.0, status="rejected",
        ))

    def get_open_orders(self, symbol: str = "") -> list[Order]:
        return [o for o in self._orders.values() if not o.is_done]

    # -- Futures helpers -------------------------------------------------------

    def set_leverage(self, symbol: str, leverage: int) -> None:
        pass  # Paper: no exchange to set it on, but track it per position later

    # -- Trade history ---------------------------------------------------------

    def fetch_trade_history(self, symbol: str = "", limit: int = 50) -> list[dict]:
        """Return locally recorded filled orders."""
        results: list[dict] = []
        for o in self._orders.values():
            if o.status != "closed":
                continue
            if symbol and o.symbol != self.normalize_symbol(symbol):
                continue
            results.append({
                "id": o.id,
                "symbol": o.symbol,
                "side": o.side,
                "amount": o.filled,
                "price": o.avg_price or 0,
                "cost": o.cost,
                "fee": o.fee,
                "timestamp": o.created_at,
                "realized_pnl": None,
            })
        return results[-limit:]

    # -- Symbol normalization --------------------------------------------------

    def normalize_symbol(self, symbol: str) -> str:
        """Normalize to CCXT format."""
        symbol = symbol.strip()
        if symbol.endswith(":USDT"):
            symbol = symbol[: -len(":USDT")]
        if "/" not in symbol:
            for delim in ("-", "_"):
                if delim in symbol:
                    base, quote = symbol.split(delim, 1)
                    quote = "USDT" if quote.upper() in ("USD", "USDC", "BUSD") else quote.upper()
                    symbol = f"{base.upper()}/{quote}"
                    break
            else:
                for quote in ("USDT", "USDC", "BUSD", "USD", "BTC", "ETH"):
                    if symbol.upper().endswith(quote) and len(symbol) > len(quote):
                        base = symbol[: -len(quote)]
                        symbol = f"{base.upper()}/{quote}"
                        break
                else:
                    symbol = f"{symbol.upper()}/USDT"
        if self.market_type == "swap" and ":" not in symbol:
            return f"{symbol}:USDT"
        return symbol

    # -- Internal simulation ---------------------------------------------------

    def _simulate_fill(self, order: Order) -> None:
        """Immediately fill market orders at current price."""
        if order.type != "market":
            # Non-market orders would require price crossing logic.
            # For simplicity in this initial version, fill them immediately too.
            pass

        try:
            fill_price = order.price if order.price else self._get_last_price(order.symbol)
        except Exception as e:
            logger.warning("Could not get price for %s: %s — skipping fill", order.symbol, e)
            order.status = "rejected"
            return

        order.avg_price = fill_price
        cost = order.amount * fill_price
        order.cost = cost
        order.filled = order.amount
        order.remaining = 0.0
        order.status = "closed"

        quote_currency = "USDT"
        base_currency = order.symbol.split("/")[0]

        if order.side == "buy":
            # Deduct quote, add base
            if self._free.get(quote_currency, 0.0) < cost:
                logger.warning("Paper: insufficient %s for buy %s", quote_currency, order.symbol)
                order.status = "rejected"
                return
            self._free[quote_currency] = self._free.get(quote_currency, 0.0) - cost
            self._free[base_currency] = self._free.get(base_currency, 0.0) + order.amount

            # Update or create position
            existing = self._positions.get(order.symbol)
            if existing and existing.side == "long":
                new_amount = existing.amount + order.amount
                new_entry = (
                    (existing.entry_price * existing.amount + fill_price * order.amount)
                    / new_amount
                )
                self._positions[order.symbol] = ExchangePosition(
                    symbol=order.symbol, side="long", amount=new_amount, entry_price=new_entry,
                    stop_loss=order.stop_loss, take_profit=order.take_profit,
                )
            elif existing and existing.side == "short":
                # Buying reduces/closes a short
                if order.amount >= existing.amount:
                    # Full close
                    realized = (existing.entry_price - fill_price) * existing.amount
                    self._realized_pnl += realized
                    self._free[quote_currency] = self._free.get(quote_currency, 0.0) + realized
                    del self._positions[order.symbol]
                else:
                    # Partial close
                    realized = (existing.entry_price - fill_price) * order.amount
                    self._realized_pnl += realized
                    self._free[quote_currency] = self._free.get(quote_currency, 0.0) + realized
                    existing.amount -= order.amount
            else:
                self._positions[order.symbol] = ExchangePosition(
                    symbol=order.symbol, side="long", amount=order.amount, entry_price=fill_price,
                    stop_loss=order.stop_loss, take_profit=order.take_profit,
                )

        elif order.side == "sell":
            if self._free.get(base_currency, 0.0) < order.amount:
                logger.warning("Paper: insufficient %s for sell %s", base_currency, order.symbol)
                order.status = "rejected"
                return

            # Spot sell: remove base, add quote
            if self.market_type == "spot":
                self._free[base_currency] = self._free.get(base_currency, 0.0) - order.amount
                self._free[quote_currency] = self._free.get(quote_currency, 0.0) + cost

                existing = self._positions.get(order.symbol)
                if existing and existing.side == "long":
                    if order.amount >= existing.amount:
                        realized = (fill_price - existing.entry_price) * existing.amount
                        self._realized_pnl += realized
                        self._free[quote_currency] += realized
                        del self._positions[order.symbol]
                    else:
                        realized = (fill_price - existing.entry_price) * order.amount
                        self._realized_pnl += realized
                        self._free[quote_currency] += realized
                        existing.amount -= order.amount
            else:
                # Futures: open/close short
                existing = self._positions.get(order.symbol)
                if existing and existing.side == "long":
                    if order.amount >= existing.amount:
                        realized = (fill_price - existing.entry_price) * existing.amount
                        self._realized_pnl += realized
                        self._free[quote_currency] = self._free.get(quote_currency, 0.0) + realized
                        del self._positions[order.symbol]
                    else:
                        realized = (fill_price - existing.entry_price) * order.amount
                        self._realized_pnl += realized
                        self._free[quote_currency] = self._free.get(quote_currency, 0.0) + realized
                        existing.amount -= order.amount
                elif existing and existing.side == "short":
                    new_amount = existing.amount + order.amount
                    new_entry = (
                        (existing.entry_price * existing.amount + fill_price * order.amount)
                        / new_amount
                    )
                    self._positions[order.symbol] = ExchangePosition(
                        symbol=order.symbol, side="short", amount=new_amount, entry_price=new_entry,
                        stop_loss=order.stop_loss, take_profit=order.take_profit,
                    )
                else:
                    self._positions[order.symbol] = ExchangePosition(
                        symbol=order.symbol, side="short", amount=order.amount, entry_price=fill_price,
                        stop_loss=order.stop_loss, take_profit=order.take_profit,
                    )

        # Persist state after successful fill
        if order.status == "closed":
            self._save_state()

    # -- Position monitoring (SL/TP simulation) ---------------------------------

    def monitor_positions(self, market_data=None) -> list[dict]:
        """Check open positions for SL/TP breaches and return alerts only.

        When *market_data* (a :class:`MarketDataCache`) is provided, prices are
        read from the WebSocket cache rather than REST, reducing latency.
        """
        alerts: list[dict] = []
        for sym, pos in list(self._positions.items()):
            if pos.stop_loss is None and pos.take_profit is None:
                continue
            try:
                current_price = self._get_last_price(sym, market_data=market_data)
            except Exception:
                continue

            triggered = None  # "sl" or "tp"

            if pos.side == "long":
                if pos.stop_loss and current_price <= pos.stop_loss:
                    triggered = "sl"
                elif pos.take_profit and current_price >= pos.take_profit:
                    triggered = "tp"
            else:  # short
                if pos.stop_loss and current_price >= pos.stop_loss:
                    triggered = "sl"
                elif pos.take_profit and current_price <= pos.take_profit:
                    triggered = "tp"

            if triggered is None:
                continue

            realized = (
                (current_price - pos.entry_price) * pos.amount
                if pos.side == "long"
                else (pos.entry_price - current_price) * pos.amount
            )

            label = "SL" if triggered == "sl" else "TP"
            level = pos.stop_loss if triggered == "sl" else pos.take_profit
            alerts.append({
                "type": f"{label}_HIT",
                "symbol": sym,
                "side": pos.side,
                "price": round(current_price, 4),
                "level": level,
                "estimated_pnl": round(realized, 2),
                "message": (
                    f"{label} ALERT: {sym} {pos.side} touched ${current_price:.4f} "
                    f"({label}=${level:.4f}) | Estimated P&L: ${realized:+.2f}. "
                    "No automatic close was performed."
                ),
            })
            logger.info(alerts[-1]["message"])
        return alerts

    @property
    def realized_pnl(self) -> float:
        return self._realized_pnl
