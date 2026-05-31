from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from luna_workstation.dataflows.ccxt_provider import _normalize_symbol
from luna_workstation.domain.market_context import (
    CrossVenueCheck,
    MarketContext,
    MarketQuality,
    OrderBookDepth,
    OrderBookSnapshot,
    RecentTradesSnapshot,
    TickerSnapshot,
)


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


def build_market_context(
    *,
    symbol: str,
    market_type: str,
    primary_venue: str,
    validation_venues: list[str],
    exchange_loader,
    divergence_threshold_bps: float,
) -> MarketContext:
    observed_at = utc_now_iso()
    missing_data: list[str] = []
    degradation_reasons: list[str] = []
    primary_exchange = exchange_loader(primary_venue)
    normalized_symbol = _normalize_symbol(symbol, primary_exchange)

    ticker = _fetch_ticker(primary_exchange, normalized_symbol, missing_data)
    order_book = _fetch_order_book(primary_exchange, normalized_symbol, missing_data)
    recent_trades = _fetch_recent_trades(
        primary_exchange,
        normalized_symbol,
        missing_data,
    )
    checks = _validate_venues(
        normalized_symbol,
        primary_last=ticker.last if ticker else None,
        validation_venues=validation_venues,
        exchange_loader=exchange_loader,
        divergence_threshold_bps=divergence_threshold_bps,
        degradation_reasons=degradation_reasons,
    )

    status = "degraded" if missing_data or degradation_reasons else "clean"
    return MarketContext(
        symbol=normalized_symbol,
        market_type=market_type,
        primary_venue=primary_venue,
        observed_at=observed_at,
        ticker=ticker,
        order_book=order_book,
        recent_trades=recent_trades,
        cross_venue_checks=checks,
        quality=MarketQuality(
            status=status,
            missing_data=_dedupe(missing_data),
            degradation_reasons=_dedupe(degradation_reasons),
        ),
    )


def _fetch_ticker(
    exchange,
    symbol: str,
    missing_data: list[str],
) -> TickerSnapshot | None:
    try:
        raw = exchange.fetch_ticker(symbol)
    except Exception:
        missing_data.append("ticker")
        return None
    return TickerSnapshot(
        venue=exchange.id,
        symbol=symbol,
        last=_number(raw.get("last")),
        bid=_number(raw.get("bid")),
        ask=_number(raw.get("ask")),
        volume_24h=_number(raw.get("baseVolume") or raw.get("quoteVolume")),
        source_timestamp=raw.get("datetime"),
    )


def _fetch_order_book(
    exchange,
    symbol: str,
    missing_data: list[str],
) -> OrderBookSnapshot | None:
    try:
        raw = exchange.fetch_order_book(symbol, limit=50)
    except Exception:
        missing_data.append("order_book")
        return None
    bids = [[float(p), float(a)] for p, a in raw.get("bids", []) if p and a]
    asks = [[float(p), float(a)] for p, a in raw.get("asks", []) if p and a]
    if not bids or not asks:
        missing_data.append("order_book")
        return None
    best_bid = bids[0][0]
    best_ask = asks[0][0]
    mid = (best_bid + best_ask) / 2
    depth = calculate_depth(bids, asks, mid_price=mid)
    return OrderBookSnapshot(
        venue=exchange.id,
        symbol=symbol,
        mid_price=round(mid, 8),
        spread_bps=calculate_spread_bps(best_bid, best_ask),
        depth=depth,
        imbalance=calculate_imbalance(depth.bid_50bps, depth.ask_50bps),
        source_timestamp=raw.get("datetime"),
    )


def _fetch_recent_trades(
    exchange,
    symbol: str,
    missing_data: list[str],
) -> RecentTradesSnapshot | None:
    try:
        raw = exchange.fetch_trades(symbol, limit=50)
    except Exception:
        missing_data.append("recent_trades")
        return None
    vwap, volume, count = calculate_vwap(raw)
    if count == 0:
        missing_data.append("recent_trades")
        return None
    latest_timestamp = raw[-1].get("datetime") if raw else None
    return RecentTradesSnapshot(
        venue=exchange.id,
        symbol=symbol,
        trade_count=count,
        vwap=vwap,
        volume=volume,
        source_timestamp=latest_timestamp,
    )


def _validate_venues(
    symbol: str,
    *,
    primary_last: float | None,
    validation_venues: list[str],
    exchange_loader,
    divergence_threshold_bps: float,
    degradation_reasons: list[str],
) -> list[CrossVenueCheck]:
    checks: list[CrossVenueCheck] = []
    for venue in validation_venues:
        try:
            exchange = exchange_loader(venue)
            normalized_symbol = _normalize_symbol(symbol, exchange)
            raw = exchange.fetch_ticker(normalized_symbol)
            last = _number(raw.get("last"))
            divergence = divergence_bps(primary_last, last)
            status = (
                "degraded"
                if divergence is not None
                and abs(divergence) > divergence_threshold_bps
                else "clean"
            )
            if status == "degraded":
                degradation_reasons.append(f"cross_venue_price_divergence:{venue}")
            checks.append(
                CrossVenueCheck(
                    venue=venue,
                    symbol=normalized_symbol,
                    last=last,
                    divergence_bps=divergence,
                    status=status,
                    source_timestamp=raw.get("datetime"),
                )
            )
        except Exception as exc:
            degradation_reasons.append(f"cross_venue_unavailable:{venue}")
            checks.append(
                CrossVenueCheck(
                    venue=venue,
                    symbol=symbol,
                    status="missing",
                    error=str(exc)[:200],
                )
            )
    return checks


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))
