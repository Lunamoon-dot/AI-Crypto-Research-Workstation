from luna_workstation.graph.market_context import precompute_market_context
from luna_workstation.graph.research_agents_graph import ResearchAgentsGraph
from luna_workstation.graph.run_context import GraphRunContext


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


def test_research_graph_skips_market_context_when_market_analyst_not_selected(
    monkeypatch,
):
    def fail_precompute(*_args, **_kwargs):
        raise AssertionError("market context should not be precomputed")

    monkeypatch.setattr(
        "luna_workstation.graph.research_agents_graph.precompute_market_context",
        fail_precompute,
    )

    graph = ResearchAgentsGraph.__new__(ResearchAgentsGraph)
    graph.config = {}
    graph.run_context = GraphRunContext()
    graph.selected_analysts = ("news", "social")

    assert graph._precompute_market_context("BTC/USDT", "2026-05-31") == ""
    assert graph.market_context_result is None
