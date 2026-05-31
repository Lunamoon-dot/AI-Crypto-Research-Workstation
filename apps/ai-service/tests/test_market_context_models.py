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
