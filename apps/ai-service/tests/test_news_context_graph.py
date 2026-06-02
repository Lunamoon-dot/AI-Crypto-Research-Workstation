from luna_workstation.graph.news_context import precompute_news_context
from luna_workstation.graph.research_agents_graph import ResearchAgentsGraph
from luna_workstation.graph.run_context import GraphRunContext


def test_precompute_news_context_uses_config_policy(monkeypatch):
    captured = {}

    def fake_build_news_context(**kwargs):
        captured.update(kwargs)

        class FakeContext:
            quality = type(
                "Quality",
                (),
                {"status": "clean", "score": 0.9, "reason_codes": []},
            )()

            def to_prompt_block(self):
                return "NEWS CONTEXT BLOCK"

        return FakeContext()

    monkeypatch.setattr(
        "luna_workstation.graph.news_context.build_news_context",
        fake_build_news_context,
    )

    prompt, result = precompute_news_context(
        {
            "news_context": {
                "enabled": True,
                "lookback_days": 3,
                "feed_timeout_sec": 2.5,
            }
        },
        "ARB/USDT",
        "2026-05-31",
    )

    assert prompt == "NEWS CONTEXT BLOCK"
    assert result.quality.status == "clean"
    assert captured["symbol"] == "ARB/USDT"
    assert captured["start_date"] == "2026-05-28"
    assert captured["end_date"] == "2026-05-31"
    assert captured["timeout_sec"] == 2.5


def test_precompute_news_context_reports_missing_cache_when_cache_mode_enabled():
    prompt, result = precompute_news_context(
        {
            "news_context": {
                "enabled": True,
                "lookback_days": 3,
                "selected_source_packs": ["pack_exchange_announcements"],
                "use_article_cache": True,
            }
        },
        "BTC/USDT",
        "2026-06-03",
    )

    assert result is not None
    assert result.quality.status == "insufficient_data"
    assert "missing_news_article_cache" in result.quality.reason_codes
    assert "missing_news_article_cache" in prompt


def test_research_graph_skips_news_context_when_news_analyst_not_selected(monkeypatch):
    def fail_precompute(*_args, **_kwargs):
        raise AssertionError("news context should not be precomputed")

    monkeypatch.setattr(
        "luna_workstation.graph.research_agents_graph.precompute_news_context",
        fail_precompute,
    )

    graph = ResearchAgentsGraph.__new__(ResearchAgentsGraph)
    graph.config = {}
    graph.run_context = GraphRunContext()
    graph.selected_analysts = ("market", "social")

    assert graph._precompute_news_context("BTC/USDT", "2026-05-31") == ""
    assert graph.news_context_result is None
