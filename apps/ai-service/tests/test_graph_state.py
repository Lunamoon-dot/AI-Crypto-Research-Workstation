from luna_workstation.graph.propagation import Propagator


def test_initial_state_defaults_market_type_to_perp():
    state = Propagator().create_initial_state("BTC/USDT", "2026-06-03")

    assert state["market_type"] == "perp"
