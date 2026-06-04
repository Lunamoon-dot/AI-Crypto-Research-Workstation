from luna_workstation.agents.utils import sentiment_tools
from luna_workstation.agents.utils.sentiment_tools import get_fear_greed_index
from luna_workstation.dataflows.sentiment_provider import (
    _fetch_fear_greed_snapshot,
    aggregate_news_sentiment,
    build_social_context_from_trending,
    fetch_social_sentiment,
)


def test_news_sentiment_low_headline_count_is_weak_warning_only():
    headlines = "\n".join(
        [
            "BNB faces lawsuit pressure after exchange regulatory concerns",
            "Analysts warn of weak participation in BNB spot markets",
            "Exchange token sentiment falls after market-wide selloff",
            "BNB trading volume declines as traders wait for catalyst",
            "Crypto market sees negative headlines around centralized venues",
        ]
    )

    text = aggregate_news_sentiment(headlines)

    assert "Headlines analyzed: 5" in text
    assert "Sentiment score: 0/100" in text
    assert "Sample-size gate" in text
    assert "weak context/warning only" in text
    assert "not strong evidence" in text
    assert "predominantly negative" not in text


def test_fear_greed_tool_is_macro_context_not_coin_specific(monkeypatch):
    monkeypatch.setattr(
        sentiment_tools,
        "fetch_crypto_fear_greed",
        lambda: "Crypto Fear & Greed Index\nCoverage: broad crypto market mood.",
    )

    text = get_fear_greed_index.invoke({"symbol": "BNB/USDT"})

    assert "broad crypto market mood" in text
    assert "Use for BNB/USDT only as macro sentiment context" in text
    assert "asset-specific news" in text


def test_fear_greed_snapshot_parses_latest_score_not_date(monkeypatch):
    monkeypatch.setattr(
        "luna_workstation.dataflows.sentiment_provider.fetch_crypto_fear_greed",
        lambda: "\n".join(
            [
                "Crypto Fear & Greed Index (market-wide macro sentiment)",
                "  2026-06-04: 12/100 - Extreme Fear",
                "  2026-06-03: 11/100 - Extreme Fear",
            ]
        ),
    )

    assert _fetch_fear_greed_snapshot() == (12, "Extreme Fear")


def test_build_social_context_from_trending_marks_high_attention():
    trending = [
        {
            "item": {
                "symbol": "ETH",
                "name": "Ethereum",
                "market_cap_rank": 2,
                "score": 92,
            }
        }
    ]

    context = build_social_context_from_trending(
        symbol="ETH/USDT",
        trending=trending,
        fear_greed_value=82,
        fear_greed_label="Extreme Greed",
    )

    assert context.quality.status == "clean"
    assert context.asset_attention is not None
    assert context.asset_attention.trending_rank == 1
    assert context.asset_attention.attention_label == "high"
    assert context.macro_mood is not None
    assert context.macro_mood.fear_greed_label == "Extreme Greed"


def test_build_social_context_from_trending_marks_missing_social_feed():
    context = build_social_context_from_trending(
        symbol="LONGTAIL/USDT",
        trending=[],
        fear_greed_value=45,
        fear_greed_label="Neutral",
    )

    assert context.quality.status == "insufficient_data"
    assert context.asset_attention is None
    assert context.quality.reason_codes == ["missing_social_feed"]


def test_fetch_social_sentiment_renders_context_without_news_language(monkeypatch):
    monkeypatch.setattr(
        "luna_workstation.dataflows.sentiment_provider._fetch_coingecko_trending",
        lambda: [
            {
                "item": {
                    "symbol": "ETH",
                    "name": "Ethereum",
                    "market_cap_rank": 2,
                    "score": 92,
                }
            }
        ],
    )
    monkeypatch.setattr(
        "luna_workstation.dataflows.sentiment_provider._fetch_fear_greed_snapshot",
        lambda: (82, "Extreme Greed"),
    )

    rendered = fetch_social_sentiment("ETH/USDT", "crypto")

    assert "PRE-COMPUTED SOCIAL CONTEXT" in rendered
    assert "Fear & Greed: 82 (Extreme Greed)" in rendered
    assert "Scope: market-wide crypto mood, not coin-specific sentiment" in rendered
    assert "Asset attention: high" in rendered
    assert "missing_news_feed" not in rendered
