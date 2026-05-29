from luna_workstation.agents.utils import sentiment_tools
from luna_workstation.agents.utils.sentiment_tools import get_fear_greed_index
from luna_workstation.dataflows.sentiment_provider import aggregate_news_sentiment


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
