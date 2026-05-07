"""LangChain tool wrappers for sentiment data sources."""

from __future__ import annotations

from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.sentiment_provider import (
    fetch_crypto_fear_greed,
    fetch_social_sentiment,
    aggregate_news_sentiment,
)


@tool
def get_fear_greed_index(
    symbol: Annotated[str, "Trading pair for context"],
) -> str:
    """Fetch the current Crypto Fear & Greed Index (alternative.me).

    Values range from 0 (Extreme Fear) to 100 (Extreme Greed).  Extreme fear
    often signals buying opportunities; extreme greed warns of correction risk.
    """
    return fetch_crypto_fear_greed()


@tool
def get_social_sentiment(
    symbol: Annotated[str, "Ticker or trading pair symbol, e.g. AAPL, BTC/USDT"],
) -> str:
    """Fetch social media sentiment and trending data for a crypto pair.

    Returns CoinGecko trending rank and social interest score.
    """
    return fetch_social_sentiment(symbol, "crypto")


@tool
def get_news_sentiment_aggregate(
    symbol: Annotated[str, "Ticker symbol for context"],
) -> str:
    """Aggregate recent news headlines into a bullish/bearish sentiment score.

    Uses keyword-based heuristic to score the tone of recent headlines.
    Returns a 0-100 score with interpretation.  This complements the full
    news reports from the News Analyst by providing a quick quantitative read.
    """
    from tradingagents.dataflows.interface import route_to_vendor
    import json

    try:
        raw = route_to_vendor("get_news", symbol)
        # If raw is JSON, extract headlines; otherwise treat as text
        if raw.strip().startswith("{"):
            data = json.loads(raw)
            headlines = "\n".join(
                item.get("title", "") for item in data.get("feed", [])
            )
        else:
            headlines = raw
        return aggregate_news_sentiment(headlines)
    except Exception:
        return "News Sentiment: could not fetch headlines for aggregation."
