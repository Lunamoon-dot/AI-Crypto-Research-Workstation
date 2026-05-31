from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from luna_workstation.domain.market_context import OrderBookDepth


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def calculate_spread_bps(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None or bid <= 0 or ask <= 0:
        return None
    mid = (bid + ask) / 2
    if mid <= 0:
        return None
    return round(((ask - bid) / mid) * 10_000, 2)


def _sum_depth(
    levels: list[list[float]],
    *,
    mid_price: float,
    bps: int,
    side: str,
) -> float:
    threshold = mid_price * (bps / 10_000)
    total = 0.0
    for price, amount in levels:
        if side == "bid" and price >= mid_price - threshold:
            total += float(amount)
        if side == "ask" and price <= mid_price + threshold:
            total += float(amount)
    return round(total, 8)


def calculate_depth(
    bids: list[list[float]],
    asks: list[list[float]],
    *,
    mid_price: float,
) -> OrderBookDepth:
    return OrderBookDepth(
        bid_10bps=_sum_depth(bids, mid_price=mid_price, bps=10, side="bid"),
        ask_10bps=_sum_depth(asks, mid_price=mid_price, bps=10, side="ask"),
        bid_25bps=_sum_depth(bids, mid_price=mid_price, bps=25, side="bid"),
        ask_25bps=_sum_depth(asks, mid_price=mid_price, bps=25, side="ask"),
        bid_50bps=_sum_depth(bids, mid_price=mid_price, bps=50, side="bid"),
        ask_50bps=_sum_depth(asks, mid_price=mid_price, bps=50, side="ask"),
    )


def calculate_imbalance(bid_depth: float, ask_depth: float) -> float | None:
    total = bid_depth + ask_depth
    if total <= 0:
        return None
    return round((bid_depth - ask_depth) / total, 4)


def calculate_vwap(trades: list[dict[str, Any]]) -> tuple[float | None, float, int]:
    total_qty = 0.0
    total_notional = 0.0
    count = 0
    for trade in trades:
        price = _number(trade.get("price"))
        amount = _number(trade.get("amount"))
        if price is None or amount is None or price <= 0 or amount <= 0:
            continue
        total_qty += amount
        total_notional += price * amount
        count += 1
    if total_qty <= 0:
        return None, 0.0, 0
    return round(total_notional / total_qty, 2), round(total_qty, 8), count


def divergence_bps(primary: float | None, comparison: float | None) -> float | None:
    if primary is None or comparison is None or primary <= 0:
        return None
    return round(((comparison - primary) / primary) * 10_000, 2)


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None
