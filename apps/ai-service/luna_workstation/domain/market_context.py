from __future__ import annotations

from pydantic import BaseModel, Field


class TickerSnapshot(BaseModel):
    venue: str
    symbol: str
    last: float | None = None
    bid: float | None = None
    ask: float | None = None
    volume_24h: float | None = None
    source_timestamp: str | None = None

    @property
    def spread_bps(self) -> float | None:
        if self.bid is None or self.ask is None or self.bid <= 0 or self.ask <= 0:
            return None
        mid = (self.bid + self.ask) / 2
        if mid <= 0:
            return None
        return round(((self.ask - self.bid) / mid) * 10_000, 2)


class OrderBookDepth(BaseModel):
    bid_10bps: float = 0.0
    ask_10bps: float = 0.0
    bid_25bps: float = 0.0
    ask_25bps: float = 0.0
    bid_50bps: float = 0.0
    ask_50bps: float = 0.0


class OrderBookSnapshot(BaseModel):
    venue: str
    symbol: str
    mid_price: float | None = None
    spread_bps: float | None = None
    depth: OrderBookDepth = Field(default_factory=OrderBookDepth)
    imbalance: float | None = None
    source_timestamp: str | None = None


class RecentTradesSnapshot(BaseModel):
    venue: str
    symbol: str
    trade_count: int = 0
    vwap: float | None = None
    volume: float = 0.0
    source_timestamp: str | None = None


class CrossVenueCheck(BaseModel):
    venue: str
    symbol: str
    last: float | None = None
    divergence_bps: float | None = None
    status: str = "missing"
    source_timestamp: str | None = None
    error: str | None = None


class MarketQuality(BaseModel):
    status: str = "clean"
    missing_data: list[str] = Field(default_factory=list)
    degradation_reasons: list[str] = Field(default_factory=list)


class MarketContext(BaseModel):
    symbol: str
    market_type: str
    primary_venue: str
    observed_at: str
    ticker: TickerSnapshot | None = None
    order_book: OrderBookSnapshot | None = None
    recent_trades: RecentTradesSnapshot | None = None
    cross_venue_checks: list[CrossVenueCheck] = Field(default_factory=list)
    quality: MarketQuality = Field(default_factory=MarketQuality)

    def to_prompt_block(self) -> str:
        lines = [
            "===== PRE-COMPUTED MARKET CONTEXT =====",
            f"Instrument: {self.symbol}",
            f"Market type: {self.market_type}",
            f"Primary venue: {self.primary_venue}",
            f"Observed at: {self.observed_at}",
            f"Quality: {self.quality.status}",
            "",
            "Primary ticker:",
        ]
        if self.ticker is None:
            lines.append("- unavailable")
        else:
            spread = self.ticker.spread_bps
            lines.extend(
                [
                    f"- Last: {self.ticker.last}",
                    f"- Bid / Ask: {self.ticker.bid} / {self.ticker.ask}",
                    f"- Spread: {spread if spread is not None else 'unknown'} bps",
                    f"- 24h volume: {self.ticker.volume_24h}",
                ]
            )

        lines.extend(["", "Order book:"])
        if self.order_book is None:
            lines.append("- unavailable")
        else:
            depth = self.order_book.depth
            lines.extend(
                [
                    f"- Mid price: {self.order_book.mid_price}",
                    f"- Spread: {self.order_book.spread_bps} bps",
                    f"- Depth +/-10 bps: bid {depth.bid_10bps} / ask {depth.ask_10bps}",
                    f"- Depth +/-25 bps: bid {depth.bid_25bps} / ask {depth.ask_25bps}",
                    f"- Depth +/-50 bps: bid {depth.bid_50bps} / ask {depth.ask_50bps}",
                    f"- Imbalance: {self.order_book.imbalance}",
                ]
            )

        lines.extend(["", "Recent trades:"])
        if self.recent_trades is None:
            lines.append("- unavailable")
        else:
            lines.extend(
                [
                    f"- Count: {self.recent_trades.trade_count}",
                    f"- VWAP: {self.recent_trades.vwap}",
                    f"- Volume: {self.recent_trades.volume}",
                ]
            )

        lines.extend(["", "Cross-venue validation:"])
        if not self.cross_venue_checks:
            lines.append("- none")
        for check in self.cross_venue_checks:
            if check.error:
                lines.append(
                    f"- {check.venue}: unavailable, status {check.status}, error {check.error}"
                )
            else:
                lines.append(
                    f"- {check.venue}: last {check.last}, divergence {check.divergence_bps} bps, status {check.status}"
                )

        lines.extend(["", "Missing/degraded data:"])
        missing = [*self.quality.missing_data, *self.quality.degradation_reasons]
        if not missing:
            lines.append("- none")
        else:
            for item in missing:
                lines.append(f"- {item}")
        lines.append("===== END MARKET CONTEXT =====")
        return "\n".join(lines)
