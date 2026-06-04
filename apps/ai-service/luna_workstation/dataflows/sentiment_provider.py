"""Sentiment data sources for market mood analysis.

Provides broad crypto Fear & Greed context, social volume tracking, and
sample-size-gated news headline sentiment from free/accessible endpoints.
"""

from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timezone
from typing import Optional

from luna_workstation.domain.social_context import (
    SocialAssetAttention,
    SocialContext,
    SocialMacroMood,
    SocialQuality,
)

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
    """Fetch social retail-attention metrics for a crypto pair.

    Uses CoinGecko trending plus the market-wide Crypto Fear & Greed snapshot.
    """
    base = _base_symbol(symbol).lower()
    cached = _cached(f"social_{base}")
    if cached:
        return cached

    try:
        trending = _fetch_coingecko_trending()
        fear_greed_value, fear_greed_label = _fetch_fear_greed_snapshot()
        context = build_social_context_from_trending(
            symbol=symbol,
            trending=trending,
            fear_greed_value=fear_greed_value,
            fear_greed_label=fear_greed_label,
        )
        result = context.to_prompt_block()
        _set_cache(f"social_{base}", result)
        return result
    except Exception:
        result = SocialContext(
            instrument=symbol,
            macro_mood=None,
            asset_attention=None,
            quality=SocialQuality(
                status="insufficient_data",
                reason_codes=["missing_social_feed"],
            ),
        ).to_prompt_block()
        _set_cache(f"social_{base}", result)
        return result


def build_social_context_from_trending(
    *,
    symbol: str,
    trending: list[dict],
    fear_greed_value: int | None = None,
    fear_greed_label: str = "unknown",
) -> SocialContext:
    base = _base_symbol(symbol)
    found = None
    rank = None
    for index, coin in enumerate(trending, start=1):
        item = coin.get("item", {}) if isinstance(coin, dict) else {}
        if str(item.get("symbol", "")).upper() == base:
            found = item
            rank = index
            break

    macro_mood = SocialMacroMood(
        fear_greed_value=fear_greed_value,
        fear_greed_label=fear_greed_label,
        risk_note=_macro_risk_note(fear_greed_value, fear_greed_label),
    )
    if not found:
        return SocialContext(
            instrument=symbol,
            macro_mood=macro_mood,
            asset_attention=None,
            quality=SocialQuality(
                status="insufficient_data",
                reason_codes=["missing_social_feed"],
            ),
        )

    score = _float_or_none(found.get("score"))
    return SocialContext(
        instrument=symbol,
        macro_mood=macro_mood,
        asset_attention=SocialAssetAttention(
            symbol=base,
            trending_rank=rank,
            market_cap_rank=_int_or_none(found.get("market_cap_rank")),
            social_score=score,
            attention_label=_attention_label(score),
        ),
        quality=SocialQuality(status="clean", reason_codes=[]),
    )


def _fetch_coingecko_trending() -> list[dict]:
    """Fetch raw trending data from CoinGecko public API."""
    data = fetch_json_with_retry("https://api.coingecko.com/api/v3/search/trending")
    if data is None:
        return []
    return list(data.get("coins") or [])


def _fetch_fear_greed_snapshot() -> tuple[int | None, str]:
    text = fetch_crypto_fear_greed()
    match = re.search(r":\s*(\d{1,3})/100\s*-\s*([A-Za-z ]+)", text)
    value = int(match.group(1)) if match else None
    label = match.group(2).strip() if match else "unknown"
    lowered = text.lower()
    for candidate in ("Extreme Greed", "Extreme Fear", "Greed", "Fear", "Neutral"):
        if candidate.lower() in lowered:
            label = candidate
            break
    return value, label


def _base_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().split("/")[0].split(":")[0]


def _attention_label(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= 75:
        return "high"
    if score >= 40:
        return "moderate"
    return "low"


def _macro_risk_note(value: int | None, label: str) -> str:
    text = str(label or "").lower()
    if (value is not None and value >= 75) or "extreme greed" in text:
        return "Market-wide crowding/correction risk is elevated."
    if (value is not None and value <= 25) or "extreme fear" in text:
        return (
            "Market-wide fear is elevated; forced selling or capitulation risk may "
            "be present."
        )
    return "Market-wide mood is balanced or mixed."


def _int_or_none(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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
