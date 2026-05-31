# Market Analyst Input Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every research run that includes the Market Analyst precomputes and injects a rich market context bundle before the analyst writes its report.

**Architecture:** Add a Python AI-service market context layer that fetches and normalizes ticker, order book, recent trades, and cross-venue price checks. The run orchestrator computes this bundle after the quant signal, stores the rendered prompt block in graph state, and the Market Analyst consumes it through the same injection pattern used for quant signals.

**Tech Stack:** Python, Pydantic, CCXT, LangGraph state, pytest, existing LunaCrypto provider routing and analyst factories.

---

## Scope

This plan targets only the research runtime path for Market Analyst inputs. It does not add web UI, workspace venue configuration, WebSocket streams, long-term tick history, paid market data vendors, or database schema changes.

The resulting Market Analyst should receive:

- Primary venue ticker snapshot.
- Bid/ask and spread.
- Order book depth at 10, 25, and 50 bps.
- Order book imbalance.
- Recent trade VWAP and trade count.
- Cross-venue price validation against configured venues.
- A compact quality summary with missing/degraded reasons.

## File Structure

Create:

- `apps/ai-service/luna_workstation/domain/market_context.py`
  - Pydantic models and prompt rendering for market context evidence.
- `apps/ai-service/luna_workstation/dataflows/market_context_provider.py`
  - CCXT-backed fetcher and pure calculation helpers for ticker, book, trades, and venue checks.
- `apps/ai-service/luna_workstation/graph/market_context.py`
  - Research-run precompute boundary mirroring `graph/quant_signals.py`.
- `apps/ai-service/tests/test_market_context_models.py`
  - Unit tests for rendering, quality labels, and missing data summaries.
- `apps/ai-service/tests/test_market_context_provider.py`
  - Unit tests for spread, depth, VWAP, divergence, and graceful degradation.
- `apps/ai-service/tests/test_market_context_injection.py`
  - Unit tests proving the Market Analyst prompt receives the precomputed bundle.

Modify:

- `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
  - Add generic market context injection to `run_analyst_chain` and `create_analyst`.
- `apps/ai-service/luna_workstation/agents/analysts/market_analyst.py`
  - Require precomputed market context and update the system prompt.
- `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
  - Add `market_context` to graph state typing.
- `apps/ai-service/luna_workstation/graph/protocols.py`
  - Add `market_context` to `ResearchGraphState`.
- `apps/ai-service/luna_workstation/graph/run_context.py`
  - Store `market_context_result` beside `quant_signal_result`.
- `apps/ai-service/luna_workstation/graph/research_agents_graph.py`
  - Add `_precompute_market_context`.
- `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
  - Compute market context for runs where market analyst is relevant and place it in initial state.
- `apps/ai-service/luna_workstation/default_config.py`
  - Add default market context policy.
- `apps/ai-service/config/default.toml`
  - Add matching market context policy.

## Data Contract

The rendered prompt block must use this shape:

```text
===== PRE-COMPUTED MARKET CONTEXT =====
Instrument: BTC/USDT
Market type: spot
Primary venue: binance
Observed at: 2026-05-31T00:00:00Z
Quality: clean

Primary ticker:
- Last: 68000
- Bid / Ask: 67999 / 68001
- Spread: 2.94 bps
- 24h volume: 12345

Order book:
- Mid price: 68000
- Depth +/-10 bps: bid 10.5 / ask 9.7
- Depth +/-25 bps: bid 25.0 / ask 22.0
- Depth +/-50 bps: bid 50.0 / ask 47.0
- Imbalance: 0.04

Recent trades:
- Count: 3
- VWAP: 68000.50
- Volume: 1.5

Cross-venue validation:
- okx: last 68002, divergence 2.94 bps, status clean

Missing/degraded data:
- none
===== END MARKET CONTEXT =====
```

## Task 1: Market Context Domain Models

**Files:**
- Create: `apps/ai-service/luna_workstation/domain/market_context.py`
- Test: `apps/ai-service/tests/test_market_context_models.py`

- [ ] **Step 1: Write failing model/render tests**

Create `apps/ai-service/tests/test_market_context_models.py`:

```python
from luna_workstation.domain.market_context import (
    CrossVenueCheck,
    MarketContext,
    MarketQuality,
    OrderBookDepth,
    OrderBookSnapshot,
    RecentTradesSnapshot,
    TickerSnapshot,
)


def test_market_context_renders_clean_prompt_block():
    context = MarketContext(
        symbol="BTC/USDT",
        market_type="spot",
        primary_venue="binance",
        observed_at="2026-05-31T00:00:00Z",
        ticker=TickerSnapshot(
            venue="binance",
            symbol="BTC/USDT",
            last=68000.0,
            bid=67999.0,
            ask=68001.0,
            volume_24h=12345.0,
            source_timestamp="2026-05-31T00:00:00Z",
        ),
        order_book=OrderBookSnapshot(
            venue="binance",
            symbol="BTC/USDT",
            mid_price=68000.0,
            spread_bps=2.94,
            depth=OrderBookDepth(
                bid_10bps=10.5,
                ask_10bps=9.7,
                bid_25bps=25.0,
                ask_25bps=22.0,
                bid_50bps=50.0,
                ask_50bps=47.0,
            ),
            imbalance=0.04,
            source_timestamp="2026-05-31T00:00:00Z",
        ),
        recent_trades=RecentTradesSnapshot(
            venue="binance",
            symbol="BTC/USDT",
            trade_count=3,
            vwap=68000.5,
            volume=1.5,
            source_timestamp="2026-05-31T00:00:00Z",
        ),
        cross_venue_checks=[
            CrossVenueCheck(
                venue="okx",
                symbol="BTC/USDT",
                last=68002.0,
                divergence_bps=2.94,
                status="clean",
                source_timestamp="2026-05-31T00:00:00Z",
            )
        ],
        quality=MarketQuality(status="clean", missing_data=[], degradation_reasons=[]),
    )

    rendered = context.to_prompt_block()

    assert "PRE-COMPUTED MARKET CONTEXT" in rendered
    assert "Primary venue: binance" in rendered
    assert "Spread: 2.94 bps" in rendered
    assert "Depth +/-10 bps: bid 10.5 / ask 9.7" in rendered
    assert "okx: last 68002.0, divergence 2.94 bps, status clean" in rendered
    assert "Missing/degraded data:\n- none" in rendered


def test_market_context_renders_degraded_reasons():
    context = MarketContext(
        symbol="ETH/USDT",
        market_type="perp",
        primary_venue="binance",
        observed_at="2026-05-31T00:00:00Z",
        ticker=None,
        order_book=None,
        recent_trades=None,
        cross_venue_checks=[],
        quality=MarketQuality(
            status="degraded",
            missing_data=["ticker", "order_book"],
            degradation_reasons=["primary_ticker_unavailable"],
        ),
    )

    rendered = context.to_prompt_block()

    assert "Quality: degraded" in rendered
    assert "- ticker" in rendered
    assert "- order_book" in rendered
    assert "- primary_ticker_unavailable" in rendered
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_models.py -q
```

Expected: fail with `ModuleNotFoundError: No module named 'luna_workstation.domain.market_context'`.

- [ ] **Step 3: Implement domain models**

Create `apps/ai-service/luna_workstation/domain/market_context.py`:

```python
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
                lines.append(f"- {check.venue}: unavailable, status {check.status}, error {check.error}")
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
```

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_models.py -q
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/market_context.py apps/ai-service/tests/test_market_context_models.py
git commit -m "Add market context domain models"
```

## Task 2: Pure Market Context Calculations

**Files:**
- Create: `apps/ai-service/luna_workstation/dataflows/market_context_provider.py`
- Test: `apps/ai-service/tests/test_market_context_provider.py`

- [ ] **Step 1: Write failing calculation tests**

Create `apps/ai-service/tests/test_market_context_provider.py`:

```python
from luna_workstation.dataflows.market_context_provider import (
    calculate_depth,
    calculate_imbalance,
    calculate_spread_bps,
    calculate_vwap,
    divergence_bps,
)


def test_calculate_spread_bps():
    assert calculate_spread_bps(99.0, 101.0) == 200.0
    assert calculate_spread_bps(None, 101.0) is None
    assert calculate_spread_bps(0.0, 101.0) is None


def test_calculate_depth_inside_bps_bands():
    bids = [[99.95, 1.0], [99.80, 2.0], [99.40, 5.0]]
    asks = [[100.05, 1.5], [100.20, 3.0], [100.80, 6.0]]

    depth = calculate_depth(bids, asks, mid_price=100.0)

    assert depth.bid_10bps == 1.0
    assert depth.ask_10bps == 1.5
    assert depth.bid_25bps == 3.0
    assert depth.ask_25bps == 4.5
    assert depth.bid_50bps == 3.0
    assert depth.ask_50bps == 4.5


def test_calculate_imbalance():
    assert calculate_imbalance(bid_depth=60.0, ask_depth=40.0) == 0.2
    assert calculate_imbalance(bid_depth=0.0, ask_depth=0.0) is None


def test_calculate_vwap():
    trades = [
        {"price": 100.0, "amount": 1.0, "timestamp": 1},
        {"price": 102.0, "amount": 2.0, "timestamp": 2},
    ]

    assert calculate_vwap(trades) == (101.33, 3.0, 2)


def test_divergence_bps():
    assert divergence_bps(primary=100.0, comparison=101.0) == 100.0
    assert divergence_bps(primary=100.0, comparison=99.0) == -100.0
    assert divergence_bps(primary=0.0, comparison=101.0) is None
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_provider.py -q
```

Expected: fail with missing module or missing functions.

- [ ] **Step 3: Implement pure calculation helpers**

Create `apps/ai-service/luna_workstation/dataflows/market_context_provider.py` with the pure helpers first:

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from luna_workstation.domain.market_context import OrderBookDepth


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def calculate_spread_bps(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None or bid <= 0 or ask <= 0:
        return None
    mid = (bid + ask) / 2
    if mid <= 0:
        return None
    return round(((ask - bid) / mid) * 10_000, 2)


def _sum_depth(levels: list[list[float]], *, mid_price: float, bps: int, side: str) -> float:
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
```

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_provider.py -q
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/market_context_provider.py apps/ai-service/tests/test_market_context_provider.py
git commit -m "Add market context calculations"
```

## Task 3: CCXT Market Context Fetcher

**Files:**
- Modify: `apps/ai-service/luna_workstation/dataflows/market_context_provider.py`
- Modify: `apps/ai-service/tests/test_market_context_provider.py`

- [ ] **Step 1: Add fetcher tests with fake exchanges**

Append to `apps/ai-service/tests/test_market_context_provider.py`:

```python
from luna_workstation.dataflows.market_context_provider import build_market_context


class FakeExchange:
    id = "binance"
    markets = {"BTC/USDT": {"active": True}}

    def fetch_ticker(self, symbol):
        assert symbol == "BTC/USDT"
        return {
            "last": 100.0,
            "bid": 99.9,
            "ask": 100.1,
            "baseVolume": 10.0,
            "datetime": "2026-05-31T00:00:00Z",
        }

    def fetch_order_book(self, symbol, limit=50):
        assert symbol == "BTC/USDT"
        assert limit == 50
        return {
            "bids": [[99.95, 1.0], [99.80, 2.0]],
            "asks": [[100.05, 1.5], [100.20, 3.0]],
            "datetime": "2026-05-31T00:00:00Z",
        }

    def fetch_trades(self, symbol, limit=50):
        assert symbol == "BTC/USDT"
        assert limit == 50
        return [
            {"price": 100.0, "amount": 1.0, "timestamp": 1},
            {"price": 102.0, "amount": 2.0, "timestamp": 2},
        ]


class FakeValidationExchange(FakeExchange):
    id = "okx"

    def fetch_ticker(self, symbol):
        return {
            "last": 100.2,
            "bid": 100.1,
            "ask": 100.3,
            "baseVolume": 20.0,
            "datetime": "2026-05-31T00:00:00Z",
        }


def test_build_market_context_from_fake_exchanges():
    exchanges = {
        "binance": FakeExchange(),
        "okx": FakeValidationExchange(),
    }

    context = build_market_context(
        symbol="BTC/USDT",
        market_type="spot",
        primary_venue="binance",
        validation_venues=["okx"],
        exchange_loader=lambda venue: exchanges[venue],
        divergence_threshold_bps=50.0,
    )

    assert context.primary_venue == "binance"
    assert context.ticker is not None
    assert context.ticker.last == 100.0
    assert context.order_book is not None
    assert context.order_book.spread_bps == 20.0
    assert context.recent_trades is not None
    assert context.recent_trades.vwap == 101.33
    assert context.cross_venue_checks[0].venue == "okx"
    assert context.cross_venue_checks[0].status == "clean"
    assert context.quality.status == "clean"


def test_build_market_context_marks_divergence_degraded():
    exchanges = {
        "binance": FakeExchange(),
        "okx": FakeValidationExchange(),
    }

    context = build_market_context(
        symbol="BTC/USDT",
        market_type="spot",
        primary_venue="binance",
        validation_venues=["okx"],
        exchange_loader=lambda venue: exchanges[venue],
        divergence_threshold_bps=5.0,
    )

    assert context.cross_venue_checks[0].status == "degraded"
    assert "cross_venue_price_divergence:okx" in context.quality.degradation_reasons
    assert context.quality.status == "degraded"
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_provider.py -q
```

Expected: fail with `ImportError` for `build_market_context`.

- [ ] **Step 3: Implement `build_market_context`**

Append these imports and functions to `apps/ai-service/luna_workstation/dataflows/market_context_provider.py`:

```python
from luna_workstation.dataflows.ccxt_provider import _normalize_symbol
from luna_workstation.domain.market_context import (
    CrossVenueCheck,
    MarketContext,
    MarketQuality,
    OrderBookSnapshot,
    RecentTradesSnapshot,
    TickerSnapshot,
)


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
    recent_trades = _fetch_recent_trades(primary_exchange, normalized_symbol, missing_data)
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


def _fetch_ticker(exchange, symbol: str, missing_data: list[str]) -> TickerSnapshot | None:
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


def _fetch_order_book(exchange, symbol: str, missing_data: list[str]) -> OrderBookSnapshot | None:
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


def _fetch_recent_trades(exchange, symbol: str, missing_data: list[str]) -> RecentTradesSnapshot | None:
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
                if divergence is not None and abs(divergence) > divergence_threshold_bps
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
```

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_provider.py -q
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/market_context_provider.py apps/ai-service/tests/test_market_context_provider.py
git commit -m "Build market context from exchange snapshots"
```

## Task 4: Graph Precompute Boundary

**Files:**
- Create: `apps/ai-service/luna_workstation/graph/market_context.py`
- Modify: `apps/ai-service/luna_workstation/default_config.py`
- Modify: `apps/ai-service/config/default.toml`
- Test: `apps/ai-service/tests/test_market_context_graph.py`

- [ ] **Step 1: Write failing graph precompute test**

Create `apps/ai-service/tests/test_market_context_graph.py`:

```python
from luna_workstation.graph.market_context import precompute_market_context


def test_precompute_market_context_uses_config_policy(monkeypatch):
    captured = {}

    def fake_build_market_context(**kwargs):
        captured.update(kwargs)

        class FakeContext:
            quality = type("Quality", (), {"status": "clean"})()

            def to_prompt_block(self):
                return "MARKET CONTEXT BLOCK"

        return FakeContext()

    monkeypatch.setattr(
        "luna_workstation.graph.market_context.build_market_context",
        fake_build_market_context,
    )

    prompt, result = precompute_market_context(
        {
            "market_type": "spot",
            "market_context": {
                "enabled": True,
                "primary_venue": "binance",
                "validation_venues": ["okx", "bybit"],
                "divergence_threshold_bps": 25.0,
            },
        },
        "BTC/USDT",
        "2026-05-31",
    )

    assert prompt == "MARKET CONTEXT BLOCK"
    assert result.quality.status == "clean"
    assert captured["symbol"] == "BTC/USDT"
    assert captured["market_type"] == "spot"
    assert captured["primary_venue"] == "binance"
    assert captured["validation_venues"] == ["okx", "bybit"]
    assert captured["divergence_threshold_bps"] == 25.0
```

- [ ] **Step 2: Run test and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_graph.py -q
```

Expected: fail with missing module.

- [ ] **Step 3: Implement graph boundary**

Create `apps/ai-service/luna_workstation/graph/market_context.py`:

```python
from __future__ import annotations

import logging

from luna_workstation.dataflows.ccxt_provider import _get_exchange
from luna_workstation.dataflows.market_context_provider import build_market_context

logger = logging.getLogger(__name__)


def precompute_market_context(config: dict, symbol: str, trade_date: str):
    policy = dict(config.get("market_context", {}))
    if policy.get("enabled") is False:
        return "", None

    primary_venue = str(policy.get("primary_venue") or config.get("crypto_exchange") or "binance")
    validation_venues = [
        str(venue).strip()
        for venue in policy.get("validation_venues", ["okx", "bybit", "bitget"])
        if str(venue).strip() and str(venue).strip() != primary_venue
    ]
    threshold = float(policy.get("divergence_threshold_bps", 25.0))
    market_type = str(config.get("market_type", "spot"))

    try:
        result = build_market_context(
            symbol=symbol,
            market_type=market_type,
            primary_venue=primary_venue,
            validation_venues=validation_venues,
            exchange_loader=_get_exchange,
            divergence_threshold_bps=threshold,
        )
    except Exception as exc:
        logger.warning("Market context unavailable for %s on %s: %s", symbol, trade_date, exc)
        return (
            "===== PRE-COMPUTED MARKET CONTEXT =====\n"
            f"Instrument: {symbol}\n"
            f"Market type: {market_type}\n"
            "Quality: degraded\n"
            "Missing/degraded data:\n"
            f"- market_context_unavailable: {str(exc)[:200]}\n"
            "===== END MARKET CONTEXT =====",
            None,
        )

    return result.to_prompt_block(), result
```

- [ ] **Step 4: Add default config**

Modify `apps/ai-service/config/default.toml`:

```toml
[market_context]
enabled = true
primary_venue = "binance"
validation_venues = ["okx", "bybit", "bitget"]
divergence_threshold_bps = 25.0
```

Modify the `DEFAULT_CONFIG` dictionary in `apps/ai-service/luna_workstation/default_config.py` to include:

```python
"market_context": {
    "enabled": True,
    "primary_venue": "binance",
    "validation_venues": ["okx", "bybit", "bitget"],
    "divergence_threshold_bps": 25.0,
},
```

- [ ] **Step 5: Run test and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_graph.py -q
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/market_context.py apps/ai-service/config/default.toml apps/ai-service/luna_workstation/default_config.py apps/ai-service/tests/test_market_context_graph.py
git commit -m "Add market context precompute boundary"
```

## Task 5: Market Analyst Prompt Injection

**Files:**
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Modify: `apps/ai-service/luna_workstation/agents/analysts/market_analyst.py`
- Modify: `apps/ai-service/luna_workstation/agents/utils/agent_states.py`
- Modify: `apps/ai-service/luna_workstation/graph/protocols.py`
- Test: `apps/ai-service/tests/test_market_context_injection.py`

- [ ] **Step 1: Write failing injection test**

Create `apps/ai-service/tests/test_market_context_injection.py`:

```python
from unittest.mock import MagicMock

from luna_workstation.agents.analysts.market_analyst import create_market_analyst


class FakeBoundLLM:
    def invoke(self, _messages):
        return MagicMock(content="market report")


class FakeLLM:
    def __init__(self):
        self.prompt = None

    def bind_tools(self, _tools):
        return FakeBoundLLM()


def test_market_analyst_injects_market_context(monkeypatch):
    captured = {}

    class FakePrompt:
        def __init__(self):
            self.partials = {}

        @classmethod
        def from_messages(cls, _messages):
            return cls()

        def partial(self, **kwargs):
            self.partials.update(kwargs)
            captured.update(kwargs)
            return self

        def __or__(self, _other):
            return FakeBoundLLM()

    monkeypatch.setattr(
        "luna_workstation.agents.utils.agent_utils.ChatPromptTemplate",
        FakePrompt,
    )

    analyst = create_market_analyst(FakeLLM(), config={"output_language": "English"})
    result = analyst(
        {
            "company_of_interest": "BTC/USDT",
            "trade_date": "2026-05-31",
            "messages": [],
            "quant_signal": "QUANT BLOCK",
            "market_context": "MARKET CONTEXT BLOCK",
        }
    )

    assert result["market_report"] == "market report"
    assert "MARKET CONTEXT BLOCK" in captured["system_message"]
    assert "QUANT BLOCK" in captured["system_message"]
```

- [ ] **Step 2: Run test and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_injection.py -q
```

Expected: fail because `market_context` is not injected into `system_message`.

- [ ] **Step 3: Add injection support**

Modify `run_analyst_chain` in `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`:

```python
def run_analyst_chain(
    *,
    llm,
    tools: list,
    system_content: str,
    state: dict,
    report_key: str,
    config=None,
    inject_quant_signal: bool = False,
    quant_signal_label: str | None = None,
    inject_market_context: bool = False,
    market_context_label: str | None = None,
) -> dict:
```

Inside the function, after the quant signal block:

```python
    if inject_market_context:
        market_block = state.get("market_context", "")
        if market_block:
            label = market_context_label or "PRE-COMPUTED MARKET CONTEXT"
            system_content += (
                f"\n\n===== {label} =====\n"
                f"{guard_untrusted_context(label, market_block)}"
                f"===== END MARKET CONTEXT =====\n"
            )
```

Modify `create_analyst` signature and nested call to pass `inject_market_context` and `market_context_label`.

- [ ] **Step 4: Enable Market Analyst context**

Modify `apps/ai-service/luna_workstation/agents/analysts/market_analyst.py` system prompt:

```python
"A pre-computed market context block is provided below. Treat it as the primary "
"market microstructure evidence for ticker, spread, order book depth, recent "
"trade VWAP, and cross-venue validation. Do not invent venues, prices, depth, "
"or tape conditions that are absent from the block.\n\n"
```

Modify `create_market_analyst`:

```python
        inject_quant_signal=True,
        inject_market_context=True,
        market_context_label="PRE-COMPUTED MARKET CONTEXT",
```

- [ ] **Step 5: Extend graph state typing**

Add to `AgentState` in `apps/ai-service/luna_workstation/agents/utils/agent_states.py`:

```python
    market_context: Annotated[
        str, "Pre-computed market microstructure and cross-venue context"
    ]
```

Add to `ResearchGraphState` in `apps/ai-service/luna_workstation/graph/protocols.py`:

```python
    market_context: str
```

- [ ] **Step 6: Run injection test and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_injection.py -q
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/agents/utils/agent_utils.py apps/ai-service/luna_workstation/agents/analysts/market_analyst.py apps/ai-service/luna_workstation/agents/utils/agent_states.py apps/ai-service/luna_workstation/graph/protocols.py apps/ai-service/tests/test_market_context_injection.py
git commit -m "Inject market context into market analyst"
```

## Task 6: Research Run Orchestrator Integration

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/run_context.py`
- Modify: `apps/ai-service/luna_workstation/graph/research_agents_graph.py`
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Test: `apps/ai-service/tests/test_run_orchestrator.py`

- [ ] **Step 1: Add orchestrator test**

Add a test to `apps/ai-service/tests/test_run_orchestrator.py`:

```python
def test_run_orchestrator_adds_market_context_to_initial_state(monkeypatch):
    from luna_workstation.graph.run_orchestrator import ResearchRunOrchestrator

    class Host:
        config = {
            "asset_class": "crypto",
            "market_type": "spot",
            "llm_provider": "test",
            "checkpoint_enabled": False,
            "data_vendors": {},
        }
        graph = None
        debug = False
        callbacks = []
        propagator = None
        current_research_run = None
        current_trade_thesis = None
        current_signals = []
        current_agent_opinions = []
        current_debate = None
        curr_state = None

        def _start_journal_run(self):
            pass

        def _precompute_quant_signal(self, symbol, trade_date):
            return "QUANT"

        def _precompute_market_context(self, symbol, trade_date):
            return "MARKET"

        def _save_journal_quant_signals(self):
            pass

        def _save_journal_agent_research(self, final_state):
            pass

        def _complete_journal_run(self):
            pass

        def _log_state(self, trade_date, final_state):
            pass

    captured = {}

    class Propagator:
        def create_initial_state(self, company_name, trade_date, past_context, market_type):
            return {
                "company_of_interest": company_name,
                "trade_date": trade_date,
                "past_context": past_context,
                "market_type": market_type,
                "messages": [],
            }

        def get_graph_args(self, callbacks=None):
            return {}

    class Graph:
        def invoke(self, init_state, **_args):
            captured.update(init_state)
            return {
                **init_state,
                "market_report": "ok",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "investment_debate_state": {},
                "risk_debate_state": {},
            }

    host = Host()
    host.graph = Graph()
    host.propagator = Propagator()

    monkeypatch.setattr(
        "luna_workstation.graph.run_orchestrator.compute_config_hash",
        lambda _config: "hash",
    )

    ResearchRunOrchestrator().run_graph(host, "BTC/USDT", "2026-05-31")

    assert captured["quant_signal"] == "QUANT"
    assert captured["market_context"] == "MARKET"
```

- [ ] **Step 2: Run test and verify red**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_run_orchestrator.py::test_run_orchestrator_adds_market_context_to_initial_state -q
```

Expected: fail because `market_context` is not added to initial state.

- [ ] **Step 3: Add run context storage**

Add to `GraphRunContext` in `apps/ai-service/luna_workstation/graph/run_context.py`:

```python
    market_context_result: Any = None
```

Add property accessors to `GraphRunContextMixin`:

```python
    @property
    def market_context_result(self) -> Any:
        return self._ensure_run_context().market_context_result

    @market_context_result.setter
    def market_context_result(self, value: Any) -> None:
        self._ensure_run_context().market_context_result = value
```

- [ ] **Step 4: Add host precompute method**

Modify `apps/ai-service/luna_workstation/graph/research_agents_graph.py`:

```python
from .market_context import precompute_market_context
```

Add method near `_precompute_quant_signal`:

```python
    def _precompute_market_context(self, symbol: str, trade_date: str) -> str:
        """Build Market Analyst context before graph execution."""
        market_prompt, result = precompute_market_context(self.config, symbol, trade_date)
        self.market_context_result = result
        return market_prompt
```

- [ ] **Step 5: Add orchestrator state injection**

Modify `apps/ai-service/luna_workstation/graph/run_orchestrator.py` after quant signal precompute:

```python
        market_context_text = ""
        if hasattr(host, "_precompute_market_context"):
            market_context_text = host._precompute_market_context(company_name, trade_date)
```

After `init_agent_state["quant_signal"] = quant_signal_text`, add:

```python
        init_agent_state["market_context"] = market_context_text
```

- [ ] **Step 6: Run orchestrator test and verify green**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_run_orchestrator.py::test_run_orchestrator_adds_market_context_to_initial_state -q
```

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/run_context.py apps/ai-service/luna_workstation/graph/research_agents_graph.py apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/tests/test_run_orchestrator.py
git commit -m "Precompute market context for research runs"
```

## Task 7: Verification And Documentation Update

**Files:**
- Modify: `docs/features/research-data-foundation/README.md`

- [ ] **Step 1: Update the market gap row**

Modify the Market row in `docs/features/research-data-foundation/README.md` to say:

```markdown
| P1 | Market | Market Analyst now has a precomputed context path for ticker, order book, recent trades, and cross-venue checks, but the implementation is REST snapshot based and does not include WebSocket streams or historical order book archives. | Breakout/liquidity theses need microstructure context, especially for smaller assets. | Treat Market Data V1 as analyst-input coverage; consider WebSocket and historical order book archives only after research quality requires them. |
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd apps/ai-service
python -m pytest tests/test_market_context_models.py tests/test_market_context_provider.py tests/test_market_context_graph.py tests/test_market_context_injection.py tests/test_run_orchestrator.py::test_run_orchestrator_adds_market_context_to_initial_state -q
```

Expected: all selected tests pass.

- [ ] **Step 3: Run lint for touched package**

Run:

```bash
cd apps/ai-service
python -m ruff check luna_workstation tests/test_market_context_models.py tests/test_market_context_provider.py tests/test_market_context_graph.py tests/test_market_context_injection.py
```

Expected: no ruff errors.

- [ ] **Step 4: Commit**

```bash
git add docs/features/research-data-foundation/README.md
git commit -m "Document market analyst input coverage"
```

## Self-Review

Spec coverage:

- Market Analyst receives a precomputed market bundle: covered by Tasks 4, 5, and 6.
- Current ticker, spread, order book depth, recent trades, and VWAP: covered by Tasks 1, 2, and 3.
- Cross-venue validation: covered by Task 3.
- No WebSocket, paid vendor, UI, or database scope: stated in Scope.
- TDD path: every implementation task starts with a failing test and red verification command.

Placeholder scan:

- No unresolved placeholders are intentionally left in this plan.
- All new files, functions, commands, and expected outcomes are named explicitly.

Type consistency:

- State key is consistently named `market_context`.
- Runtime result is consistently named `market_context_result`.
- Prompt label is consistently `PRE-COMPUTED MARKET CONTEXT`.

## Execution Handoff

Plan complete and saved to `docs/analysts_refrac/2026-05-31-market-analyst-input-bundle-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session with checkpoints.
