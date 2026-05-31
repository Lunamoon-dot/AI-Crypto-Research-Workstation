from luna_workstation.dataflows.market_context_provider import (
    build_market_context,
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
    assert context.order_book.spread_bps == 10.0
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
