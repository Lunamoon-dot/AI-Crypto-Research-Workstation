from luna_workstation.graph.propagation import Propagator


def test_initial_state_carries_latest_continuity_context():
    context = {
        "schema_version": "latest_continuity_context.v1",
        "workspace_id": "workspace_a",
        "symbol": "BTC/USDT",
        "market_type": "spot",
        "summary": "Prior thesis remains valid.",
    }

    state = Propagator().create_initial_state(
        "BTC/USDT",
        "2026-06-03",
        latest_continuity_context=context,
    )

    assert state["latest_continuity_context"] == context
