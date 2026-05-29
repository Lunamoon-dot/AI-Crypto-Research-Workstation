"""Sentiment data sources for market mood analysis.

Provides broad crypto Fear & Greed context, social volume tracking, and
sample-size-gated news headline sentiment from free/accessible endpoints.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from .http_utils import fetch_json_with_retry

logger = logging.getLogger(__name__)

# Cache to avoid hammering endpoints within a single run
_cache: dict[str, tuple[float, str]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 120  # seconds
MIN_HEADLINES_FOR_DIRECTIONAL_NEWS_SENTIMENT = 10


def _cached(key: str) -> Optional[str]:
    with _cache_lock:
        ts, val = _cache.get(key, (0, ""))
    if ts and (datetime.now(timezone.utc).timestamp() - ts) < _CACHE_TTL:
        return val
    return None


def _set_cache(key: str, val: str) -> None:
    with _cache_lock:
        _cache[key] = (datetime.now(timezone.utc).timestamp(), val)


# ---------------------------------------------------------------------------
# Fear & Greed Index — Crypto (alternative.me API, free, no key needed)
# ---------------------------------------------------------------------------


def fetch_crypto_fear_greed() -> str:
    """Fetch the market-wide Crypto Fear & Greed Index from alternative.me.

    Values: 0-24 = Extreme Fear, 25-49 = Fear, 50 = Neutral,
            51-74 = Greed, 75-100 = Extreme Greed.
    """
    cached = _cached("crypto_fng")
    if cached:
        return cached

    data = fetch_json_with_retry("https://api.alternative.me/fng/?limit=3")
    if data is None or "data" not in data:
        return "Crypto Fear & Greed Index: unavailable (API error)."

    lines = [
        "Crypto Fear & Greed Index (market-wide macro sentiment)",
        "=" * 55,
        "Coverage: broad crypto market mood, not a coin-specific signal.",
        "",
    ]
    for entry in data["data"][:3]:
        val = int(entry.get("value", 50))
        classification = entry.get("value_classification", "Neutral")
        ts = datetime.fromtimestamp(int(entry.get("timestamp", 0)), tz=timezone.utc)
        lines.append(f"  {ts.strftime('%Y-%m-%d')}: {val}/100 - {classification}")

    lines.append("")
    latest_val = int(data["data"][0]["value"])
    if latest_val <= 25:
        lines.append(
            "Extreme Fear: broad crypto risk appetite is very weak; use only as "
            "macro context and require asset-specific confirmation."
        )
    elif latest_val <= 45:
        lines.append(
            "Fear: cautious market-wide sentiment; not enough for a coin-specific "
            "entry signal."
        )
    elif latest_val <= 55:
        lines.append("Neutral: no strong market-wide sentiment bias.")
    elif latest_val <= 75:
        lines.append(
            "Greed: broad crypto risk appetite is elevated; treat as macro context, "
            "not proof of asset-specific demand."
        )
    else:
        lines.append(
            "Extreme Greed: broad market crowding/correction risk is elevated; "
            "not a standalone coin-specific signal."
        )

    result = "\n".join(lines)
    _set_cache("crypto_fng", result)
    return result


# ---------------------------------------------------------------------------
# Social volume — CoinGecko Trending (public endpoint, rate-limited)
# ---------------------------------------------------------------------------


def fetch_social_sentiment(symbol: str, asset_class: str = "crypto") -> str:
    """Fetch social media metrics for a crypto pair.

    Uses CoinGecko trending endpoint.
    """
    cached = _cached(f"social_{symbol}")
    if cached:
        return cached

    base = symbol.split("/")[0].lower() if "/" in symbol else symbol.lower()
    return _fetch_coingecko_trending(base)


def _fetch_coingecko_trending(base: str) -> str:
    """Fetch trending data from CoinGecko public API (no key needed)."""
    data = fetch_json_with_retry("https://api.coingecko.com/api/v3/search/trending")
    if data is None:
        return f"Social Sentiment for {base.upper()}: CoinGecko API unavailable."

    coins = data.get("coins", [])
    found = None
    position = None
    for i, coin in enumerate(coins):
        item = coin.get("item", {})
        if (
            item.get("symbol", "").lower() == base.lower()
            or item.get("id", "").lower() == base.lower()
        ):
            found = item
            position = i + 1
            break

    lines = [f"Social Sentiment for {base.upper()}", "=" * 40, ""]

    if found:
        lines.append(f"  CoinGecko Trending Rank: #{position}")
        lines.append(f"  Market Cap Rank: #{found.get('market_cap_rank', 'N/A')}")
        lines.append(
            f"  Score: {found.get('score', 0):.0f} (higher = more social interest)"
        )
        lines.append("")
        score = found.get("score", 0)
        if score > 500:
            lines.append("High social interest - strong retail attention.")
        elif score > 100:
            lines.append("Moderate social interest.")
        else:
            lines.append("Low social interest - flying under the radar.")
    else:
        lines.append("  Not in CoinGecko Top Trending (15 coins).")
        lines.append(
            f"  This suggests low retail attention for {base.upper()} right now."
        )

    result = "\n".join(lines)
    _set_cache(f"social_{base}", result)
    return result


# ---------------------------------------------------------------------------
# Sentiment aggregation — combines news headlines into a mood score
# ---------------------------------------------------------------------------


def aggregate_news_sentiment(headlines_csv: str) -> str:
    """Score a batch of news headlines for bullish/bearish leaning.

    Uses a keyword-based heuristic (fast, free, no LLM call needed).
    """
    if not headlines_csv or len(headlines_csv) < 50:
        return "News Sentiment: insufficient headlines for aggregation."

    bullish_words = [
        "beat",
        "upgrade",
        "raise",
        "growth",
        "profit",
        "surge",
        "rally",
        "bull",
        "breakout",
        "outperform",
        "strong",
        "positive",
        "record",
        "approval",
        "partnership",
        "launch",
        "innovation",
        "buyback",
    ]
    bearish_words = [
        "miss",
        "downgrade",
        "cut",
        "decline",
        "loss",
        "plunge",
        "crash",
        "bear",
        "breakdown",
        "underperform",
        "weak",
        "negative",
        "investigation",
        "lawsuit",
        "layoff",
        "bankruptcy",
        "default",
        "sanction",
    ]

    lines_lower = headlines_csv.lower().splitlines()
    headline_count = 0
    bull_hits = 0
    bear_hits = 0

    for line in lines_lower:
        if len(line) < 15:
            continue
        headline_count += 1
        for w in bullish_words:
            if w in line:
                bull_hits += 1
                break
        for w in bearish_words:
            if w in line:
                bear_hits += 1
                break

    if headline_count == 0:
        return "News Sentiment: no parseable headlines found."

    total = bull_hits + bear_hits
    if total == 0:
        lean = "neutral"
        score = 50
    else:
        bull_pct = bull_hits / total
        score = int(bull_pct * 100)
        if bull_pct >= 0.65:
            lean = "bullish"
        elif bull_pct <= 0.35:
            lean = "bearish"
        else:
            lean = "mixed/neutral"

    lines = [
        "News Sentiment Aggregation",
        "=" * 35,
        f"  Headlines analyzed: {headline_count}",
        f"  Bullish signals: {bull_hits}",
        f"  Bearish signals: {bear_hits}",
        f"  Sentiment score: {score}/100 - {lean}",
        "",
    ]
    if headline_count < MIN_HEADLINES_FOR_DIRECTIONAL_NEWS_SENTIMENT:
        lines.append(
            "Sample-size gate: only "
            f"{headline_count} headline(s), below the "
            f"{MIN_HEADLINES_FOR_DIRECTIONAL_NEWS_SENTIMENT}-headline minimum. "
            "Use this as weak context/warning only, not strong evidence."
        )
        lines.append(
            "Do not treat this headline score as a primary coin-specific signal."
        )
        return "\n".join(lines)

    if lean == "bullish":
        lines.append("News flow is predominantly positive.")
    elif lean == "bearish":
        lines.append("News flow is predominantly negative.")
    else:
        lines.append("News flow is mixed - no strong directional bias.")

    return "\n".join(lines)
