"""Optional crypto headline fetch (CryptoPanic) with safe fallbacks."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from luna_workstation.exceptions import DataProviderError

logger = logging.getLogger(__name__)

_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})
_BACKOFF_BASE = 0.5
_BACKOFF_MAX = 5.0
_MAX_RETRIES = 2


def _is_production_mode() -> bool:
    env_value = os.getenv("TRADINGAGENTS_RUNTIME_ENVIRONMENT", "").strip().lower()
    if env_value:
        return env_value == "production"
    try:
        from luna_workstation.dataflows.config import get_config

        runtime_environment = str(
            get_config().get("runtime_environment", "local")
        ).lower()
        return runtime_environment == "production"
    except Exception:
        return False


def _raise_missing_feed_in_production(feed_name: str) -> None:
    if _is_production_mode():
        raise DataProviderError(
            f"{feed_name} is required in production mode; configure "
            "CRYPTOPANIC_API_TOKEN instead of using placeholder news text."
        )


def _currency_code_from_ticker(ticker: str) -> str | None:
    base = ticker.strip().upper().replace(" ", "")
    if not base:
        return None
    return base.split("/")[0].split(":")[0] or None


def fetch_cryptopanic_headlines(
    *,
    ticker: str,
    start_date: str = "",
    end_date: str = "",
    limit: int = 8,
    timeout_sec: float = 12.0,
) -> list[dict[str, Any]] | None:
    """Fetch recent crypto headlines when ``CRYPTOPANIC_API_TOKEN`` is set.

    Uses CryptoPanic developer API (`https://cryptopanic.com/developers/api/`).
    Returns ``None`` on missing token, HTTP errors, or parse failures — callers
    should render deterministic placeholder text instead of inventing headlines.
    """
    token = os.getenv("CRYPTOPANIC_API_TOKEN", "").strip()
    if not token:
        _raise_missing_feed_in_production("CryptoPanic")
        return None

    currencies = _currency_code_from_ticker(ticker)
    params: dict[str, str] = {"auth_token": token, "public": "true"}
    if currencies:
        params["currencies"] = currencies

    qs = urllib.parse.urlencode(params)
    url = f"https://cryptopanic.com/api/v1/posts/?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "TradingAgents/1.0 (research workstation; Python urllib)",
            "Accept": "application/json",
        },
        method="GET",
    )

    raw = None
    attempts = _MAX_RETRIES + 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as exc:
            if exc.code in _RETRYABLE_STATUSES and attempt < _MAX_RETRIES:
                wait = min(_BACKOFF_MAX, _BACKOFF_BASE * (2**attempt))
                logger.warning(
                    "CryptoPanic HTTP %s (attempt %s/%s), retrying in %.1fs",
                    exc.code,
                    attempt + 1,
                    attempts,
                    wait,
                )
                time.sleep(wait)
                continue
            logger.warning("CryptoPanic fetch failed: HTTP %s", exc.code)
            return None
        except (TimeoutError, urllib.error.URLError, OSError) as exc:
            if attempt < _MAX_RETRIES:
                wait = min(_BACKOFF_MAX, _BACKOFF_BASE * (2**attempt))
                logger.warning(
                    "CryptoPanic network error (attempt %s/%s): %s, retrying in %.1fs",
                    attempt + 1,
                    attempts,
                    exc,
                    wait,
                )
                time.sleep(wait)
                continue
            logger.warning("CryptoPanic fetch failed: %s", exc)
            return None

    if raw is None:
        logger.warning("CryptoPanic fetch failed after %s attempts", attempts)
        return None

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("CryptoPanic response was not JSON")
        return None

    results = payload.get("results") or []
    headlines: list[dict[str, Any]] = []
    for item in results[:limit]:
        if not isinstance(item, dict):
            continue
        headlines.append(
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "published_at": item.get("published_at"),
                "source": (item.get("source") or {}).get("title")
                if isinstance(item.get("source"), dict)
                else item.get("source"),
            }
        )

    rng = ""
    if start_date or end_date:
        rng = f" ({start_date} → {end_date})"
    if not headlines:
        logger.info(
            "CryptoPanic returned no posts for %s%s — using placeholder body",
            ticker,
            rng,
        )
        return None

    return headlines


def format_cryptopanic_for_tool(
    *,
    ticker: str,
    start_date: str = "",
    end_date: str = "",
    limit: int = 8,
) -> str:
    """Produce analyst-facing Markdown: live headlines or explicit missing-data text."""
    items = fetch_cryptopanic_headlines(
        ticker=ticker, start_date=start_date, end_date=end_date, limit=limit
    )
    range_line = ""
    if start_date or end_date:
        range_line = f"*Requested window*: {start_date} → {end_date}\n\n"

    if items:
        lines = [
            f"## Crypto headline feed (CryptoPanic) for `{ticker}`",
            "",
            range_line.strip(),
            "| Title | Source | Published |",
            "| --- | --- | --- |",
        ]
        for row in items:
            title = (row.get("title") or "").replace("|", "/")
            src = (row.get("source") or "").replace("|", "/")
            published = row.get("published_at") or ""
            link = row.get("url") or ""
            cell = title if not link else f"[{title}]({link})"
            lines.append(f"| {cell} | {src} | {published} |")
        return "\n".join(lines) + "\n"

    hdr = f"Crypto news for `{ticker}` ({start_date} → {end_date})\n{'=' * 50}\n\n"

    guidance = (
        "**DATA STATUS — NO THIRD-PARTY CRYPTO NEWS FEED**\n\n"
        "DATA_STATUS: insufficient_news_evidence\n"
        "REASON_CODE: missing_news_feed\n\n"
        "Do **not** fabricate headlines, URLs, or publication dates. "
        "Explicitly label this news section as *missing primary-source crypto headlines* "
        "and synthesize actionable context only from other tools "
        "(sentiment aggregates, Fear & Greed, on-chain metrics).\n\n"
    )

    howto = (
        "Optional: enable CryptoPanic headlines by exporting `CRYPTOPANIC_API_TOKEN` "
        "(see CryptoPanic developer API). Until then treat **news-derived claims** "
        "as unsupported by this workspace.\n"
    )

    return hdr + guidance + howto


def format_global_cryptopanic_for_tool(
    *,
    curr_date: str,
    look_back_days: int = 7,
    limit: int = 6,
    timeout_sec: float = 12.0,
) -> str:
    """Macro crypto mood headlines (no ticker filter beyond global feed)."""
    token = os.getenv("CRYPTOPANIC_API_TOKEN", "").strip()
    if not token:
        _raise_missing_feed_in_production("CryptoPanic")
        return (
            f"Global crypto news snapshot (requested `curr_date={curr_date}`, "
            f"look_back≈{look_back_days}d)\n"
            f"{'=' * 50}\n\n"
            "DATA_STATUS: insufficient_news_evidence\n"
            "REASON_CODE: missing_news_feed\n\n"
            "**NO FEED.** Do not invent stories. Prefer sentiment/on-chain tools "
            "for macro mood unless `CRYPTOPANIC_API_TOKEN` is configured.\n"
        )

    headlines = fetch_cryptopanic_headlines(
        ticker="BTC",
        start_date="",
        end_date="",
        limit=limit,
        timeout_sec=timeout_sec,
    )
    # If BTC-filtered fetch is empty, still use placeholder (API may restrict filter).
    if not headlines:
        return (
            f"Global crypto headlines (BTC-filtered CryptoPanic probe on {curr_date})\n"
            f"{'=' * 50}\n\n"
            "**FEED AVAILABLE BUT EMPTY** — widen search manually or cite non-news tools.\n"
        )

    lines = [
        f"## Global crypto headlines (BTC-filtered; `curr_date={curr_date}`)",
        "",
        "| Title | Source | Published |",
        "| --- | --- | --- |",
    ]
    for row in headlines:
        title = (row.get("title") or "").replace("|", "/")
        src = (row.get("source") or "").replace("|", "/")
        published = row.get("published_at") or ""
        link = row.get("url") or ""
        cell = title if not link else f"[{title}]({link})"
        lines.append(f"| {cell} | {src} | {published} |")
    lines.append("")
    lines.append(
        "*Note*: Global feed uses a BTC currency filter via CryptoPanic; "
        "it is indicative, not exhaustive macro coverage.\n"
    )
    return "\n".join(lines)
