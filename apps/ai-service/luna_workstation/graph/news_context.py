"""News context precomputation helpers."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from luna_workstation.dataflows.news_context_provider import build_news_context

logger = logging.getLogger(__name__)


def precompute_news_context(config: dict, symbol: str, trade_date: str):
    """Return ``(prompt_block, news_context_or_none)`` for a research run."""
    policy = dict(config.get("news_context", {}) or {})
    if policy.get("enabled") is False:
        return "", None

    lookback_days = max(int(policy.get("lookback_days", 7)), 0)
    end = date.fromisoformat(str(trade_date)[:10])
    start = end - timedelta(days=lookback_days)
    timeout_sec = float(policy.get("feed_timeout_sec", 8.0))
    try:
        result = build_news_context(
            symbol=symbol,
            start_date=start.isoformat(),
            end_date=end.isoformat(),
            config=config,
            timeout_sec=timeout_sec,
        )
    except Exception as exc:
        logger.warning("News context unavailable for %s on %s: %s", symbol, trade_date, exc)
        return (
            "===== PRE-COMPUTED NEWS CONTEXT =====\n"
            f"Instrument: {symbol}\n"
            f"Window: {start.isoformat()} -> {end.isoformat()}\n"
            "Quality: insufficient_data (0.00)\n"
            "Missing/degraded data:\n"
            f"- missing_news_feed: {str(exc)[:200]}\n"
            "- insufficient_news_evidence\n"
            "Rules for analyst:\n"
            "- Do not fabricate headlines, URLs, publication dates, or catalysts.\n"
            "===== END NEWS CONTEXT =====",
            None,
        )

    return result.to_prompt_block(), result
