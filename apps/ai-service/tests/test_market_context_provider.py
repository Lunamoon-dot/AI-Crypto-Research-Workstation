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
