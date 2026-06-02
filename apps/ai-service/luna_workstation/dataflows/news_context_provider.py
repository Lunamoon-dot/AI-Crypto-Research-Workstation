"""Source-scoped news ingestion and NewsContext construction."""

from __future__ import annotations

import logging
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable

from luna_workstation.domain.news_context import (
    AssetNewsProfile,
    NewsContext,
    NewsCoverage,
    NewsItem,
    NewsItemDecision,
    NewsMateriality,
    NewsQuality,
    NewsSource,
    NewsSourceHealth,
    NewsStoryCluster,
)

logger = logging.getLogger(__name__)

FeedFetcher = Callable[[str, float], str]

DEFAULT_NEWS_SOURCES: tuple[dict[str, Any], ...] = (
    {
        "id": "binance_announcements",
        "name": "Binance Announcements",
        "type": "rss",
        "url": "https://www.binance.com/en/support/announcement/rss",
        "category": "exchange_announcements",
        "trust_tier": "high",
        "scope": ["ALL"],
        "official": True,
    },
    {
        "id": "coinbase_blog",
        "name": "Coinbase Blog",
        "type": "rss",
        "url": "https://www.coinbase.com/blog/rss.xml",
        "category": "exchange_announcements",
        "trust_tier": "high",
        "scope": ["ALL"],
        "official": True,
    },
    {
        "id": "sec_press_releases",
        "name": "SEC Press Releases",
        "type": "rss",
        "url": "https://www.sec.gov/news/pressreleases.rss",
        "category": "regulatory",
        "trust_tier": "high",
        "scope": ["ALL"],
        "official": True,
    },
    {
        "id": "coindesk",
        "name": "CoinDesk",
        "type": "rss",
        "url": "https://www.coindesk.com/arc/outboundfeeds/rss/",
        "category": "crypto_media",
        "trust_tier": "medium",
        "scope": ["ALL"],
        "official": False,
    },
)

DEFAULT_ASSET_PROFILES: dict[str, dict[str, Any]] = {
    "BTC": {
        "canonical_name": "Bitcoin",
        "aliases": ["Bitcoin", "BTC", "BTC token"],
        "disambiguation_terms": ["crypto", "token", "blockchain", "ETF"],
        "official_domains": ["bitcoin.org"],
        "symbol_only_match_allowed": True,
    },
    "ETH": {
        "canonical_name": "Ethereum",
        "aliases": ["Ethereum", "Ether", "ETH", "ETH token"],
        "disambiguation_terms": ["crypto", "token", "blockchain", "ETF"],
        "official_domains": ["ethereum.org"],
        "symbol_only_match_allowed": True,
    },
    "SOL": {
        "canonical_name": "Solana",
        "aliases": ["Solana", "SOL token"],
        "disambiguation_terms": ["crypto", "token", "blockchain"],
        "official_domains": ["solana.com"],
        "symbol_only_match_allowed": False,
    },
    "ARB": {
        "canonical_name": "Arbitrum",
        "aliases": ["Arbitrum", "ARB token", "Arbitrum DAO", "Arbitrum Foundation"],
        "disambiguation_terms": ["crypto", "token", "blockchain", "DAO"],
        "official_domains": ["arbitrum.foundation", "arbitrum.io"],
        "symbol_only_match_allowed": False,
    },
    "OP": {
        "canonical_name": "Optimism",
        "aliases": ["Optimism", "OP Mainnet", "OP token"],
        "disambiguation_terms": ["crypto", "token", "blockchain", "rollup"],
        "official_domains": ["optimism.io"],
        "symbol_only_match_allowed": False,
    },
    "NEAR": {
        "canonical_name": "NEAR Protocol",
        "aliases": ["NEAR Protocol", "NEAR token"],
        "disambiguation_terms": ["crypto", "token", "blockchain"],
        "official_domains": ["near.org"],
        "symbol_only_match_allowed": False,
    },
    "LINK": {
        "canonical_name": "Chainlink",
        "aliases": ["Chainlink", "LINK token"],
        "disambiguation_terms": ["crypto", "oracle", "token", "blockchain"],
        "official_domains": ["chain.link"],
        "symbol_only_match_allowed": False,
    },
    "TON": {
        "canonical_name": "Toncoin",
        "aliases": ["Toncoin", "TON token", "The Open Network"],
        "disambiguation_terms": ["crypto", "token", "blockchain"],
        "official_domains": ["ton.org"],
        "symbol_only_match_allowed": False,
    },
}

TRUST_SCORES = {
    "high": 0.86,
    "user_trusted": 0.82,
    "medium": 0.62,
    "low": 0.34,
    "aggregator": 0.25,
}

CATALYST_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("listing", ("listing", "lists", "listed", "margin", "futures", "perpetual")),
    ("delisting", ("delisting", "delist", "suspension", "suspend")),
    ("security_incident", ("security incident", "breach", "incident")),
    ("exploit", ("exploit", "hack", "vulnerability", "bridge attack")),
    ("regulatory", ("sec", "cftc", "regulation", "regulatory", "lawsuit")),
    ("lawsuit", ("lawsuit", "sues", "court", "settlement")),
    ("governance", ("governance", "proposal", "dao", "vote", "forum")),
    ("partnership", ("partnership", "partners", "integration")),
    ("protocol_upgrade", ("upgrade", "hard fork", "mainnet", "release")),
    ("token_unlock", ("unlock", "vesting")),
    ("etf_or_institutional", ("etf", "institutional", "fund inflow")),
    ("macro_liquidity", ("cpi", "fomc", "liquidity", "treasury", "rates")),
    ("exchange_outage", ("outage", "maintenance", "halted")),
    ("stablecoin_depeg", ("depeg", "stablecoin")),
)


def merge_news_sources(config: dict[str, Any]) -> list[NewsSource]:
    policy = dict(config.get("news_context", {}) or {})
    default_raw = policy.get("default_sources")
    if default_raw is None:
        default_raw = DEFAULT_NEWS_SOURCES
    workspace_raw = (
        policy.get("workspace_sources")
        or config.get("news_sources")
        or (config.get("workspace") or {}).get("news_sources")
        or []
    )
    workspace_id = str(
        (config.get("_engine") or {}).get("workspace_id")
        or config.get("workspace_id")
        or "local"
    )

    sources: list[NewsSource] = []
    for raw in default_raw:
        source = _source_from_raw(raw, workspace_id=None)
        if source is not None:
            sources.append(source)
    for raw in workspace_raw:
        source = _source_from_raw(raw, workspace_id=workspace_id)
        if source is not None and "news" in source.target_analysts:
            sources.append(source)
    return sources


def build_news_context(
    *,
    symbol: str,
    start_date: str,
    end_date: str,
    config: dict[str, Any],
    feed_fetcher: FeedFetcher | None = None,
    now_fn: Callable[[], str] | None = None,
    timeout_sec: float | None = None,
) -> NewsContext:
    policy = dict(config.get("news_context", {}) or {})
    if timeout_sec is None:
        timeout_sec = float(policy.get("feed_timeout_sec", 8.0))
    fetcher = feed_fetcher or _fetch_url
    fetched_at = now_fn() if now_fn is not None else _utc_now_iso()
    profile = asset_profile_for_symbol(symbol, config)
    sources = [
        source
        for source in merge_news_sources(config)
        if _source_applies_to_symbol(source, profile.symbol)
    ]

    coverage_inputs = _init_coverage(sources)
    items: list[NewsItem] = []
    failures: dict[str, list[str]] = defaultdict(list)
    successes: dict[str, list[str]] = defaultdict(list)
    source_health: list[NewsSourceHealth] = []
    item_decisions: list[NewsItemDecision] = []
    for source in sources:
        group = _coverage_group(source)
        source_type = source.type.lower()
        if source_type not in {"rss", "atom", "html"}:
            failures[group].append(source.id)
            source_health.append(
                _source_health(
                    source=source,
                    fetch_status="skipped",
                    parse_status="unsupported",
                    raw_count=0,
                    parsed_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    rejection_reasons={},
                    error_code="unsupported_source_type",
                    error_message=f"Unsupported source type: {source.type}",
                )
            )
            continue
        try:
            raw_feed = fetcher(source.url, float(timeout_sec))
        except Exception as exc:
            logger.warning("News source %s unavailable: %s", source.id, exc)
            failures[group].append(source.id)
            source_health.append(
                _source_health(
                    source=source,
                    fetch_status="failed",
                    parse_status="not_parsed",
                    raw_count=0,
                    parsed_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    rejection_reasons={},
                    error_code="source_fetch_failed",
                    error_message=str(exc)[:240],
                )
            )
            continue
        try:
            if source_type == "html":
                if source.parser_mode != "html_list":
                    raise ValueError("html source requires parser_mode=html_list")
                parsed, raw_count, parse_rejections = _parse_html_list(raw_feed, source)
            else:
                parsed, raw_count, parse_rejections = _parse_feed(
                    raw_feed, source, fetched_at=fetched_at
                )
        except Exception as exc:
            logger.warning("News source %s unparseable: %s", source.id, exc)
            failures[group].append(source.id)
            source_health.append(
                _source_health(
                    source=source,
                    fetch_status="fetched",
                    parse_status="failed",
                    raw_count=0,
                    parsed_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    rejection_reasons={},
                    error_code="source_parse_failed",
                    error_message=str(exc)[:240],
                )
            )
            continue

        successes[group].append(source.id)
        source_start_date = _source_window_start(start_date, end_date, source, policy)
        accepted_count = 0
        rejection_reasons = dict(parse_rejections)
        for entry in parsed:
            if not _within_window(entry["published_at"], source_start_date, end_date):
                _bump_reason(rejection_reasons, "out_of_window")
                item_decisions.append(
                    NewsItemDecision(
                        source_id=source.id,
                        item_url=entry["url"],
                        decision="rejected",
                        reason="out_of_window",
                    )
                )
                continue
            match = _match_asset(
                profile, entry["title"], entry.get("summary"), entry["url"]
            )
            if not match:
                _bump_reason(rejection_reasons, "asset_mismatch")
                item_decisions.append(
                    NewsItemDecision(
                        source_id=source.id,
                        item_url=entry["url"],
                        decision="rejected",
                        reason="asset_mismatch",
                    )
                )
                continue
            item = _to_news_item(
                entry,
                source=source,
                profile=profile,
                fetched_at=fetched_at,
                match=match,
                end_date=end_date,
            )
            accepted_count += 1
            item_decisions.append(
                NewsItemDecision(
                    source_id=source.id,
                    item_url=item.canonical_url,
                    decision="accepted",
                    reason="asset_match",
                    matched_alias=str(match.get("type") or "asset"),
                    relevance_score=item.relevance_score,
                )
            )
            items.append(item)
        source_health.append(
            _source_health(
                source=source,
                fetch_status="fetched",
                parse_status="parsed" if parsed else "empty",
                raw_count=raw_count,
                parsed_count=len(parsed),
                accepted_count=accepted_count,
                rejected_count=max(raw_count - accepted_count, 0),
                rejection_reasons=rejection_reasons,
            )
        )

    items = _dedupe_items(items)
    items.sort(
        key=lambda item: (
            item.relevance_score,
            item.source_trust_score,
            item.published_at,
        ),
        reverse=True,
    )
    clusters = _build_story_clusters(items)
    coverage = _build_coverage(coverage_inputs, failures, successes, items)
    materiality = _materiality_for_items(items, source_health)
    quality = _build_quality(
        items,
        failures,
        coverage,
        source_health=source_health,
        materiality=materiality,
    )
    missing_data = _missing_data_for_quality(quality)
    return NewsContext(
        instrument=symbol,
        window_start=start_date,
        window_end=end_date,
        coverage=coverage,
        quality=quality,
        materiality=materiality,
        source_health=source_health,
        item_decisions=item_decisions[:50],
        items=items[:12],
        story_clusters=clusters[:8],
        missing_data=missing_data,
    )


def asset_profile_for_symbol(symbol: str, config: dict[str, Any]) -> AssetNewsProfile:
    base = _base_symbol(symbol)
    policy = dict(config.get("news_context", {}) or {})
    configured = (policy.get("asset_profiles") or {}).get(base)
    if configured:
        return AssetNewsProfile.model_validate({"symbol": base, **configured})
    raw = DEFAULT_ASSET_PROFILES.get(base)
    if raw:
        return AssetNewsProfile.model_validate({"symbol": base, **raw})
    return AssetNewsProfile(
        symbol=base,
        canonical_name=base,
        aliases=[base, f"{base} token"],
        disambiguation_terms=["crypto", "token", "blockchain"],
        official_domains=[],
        symbol_only_match_allowed=len(base) >= 4,
    )


def _source_from_raw(raw: Any, *, workspace_id: str | None) -> NewsSource | None:
    if not isinstance(raw, dict):
        return None
    data = dict(raw)
    if not data.get("id"):
        prefix = f"workspace_{workspace_id}_" if workspace_id else ""
        data["id"] = prefix + _slug(data.get("name") or data.get("url") or "source")
    if workspace_id:
        data["workspace_id"] = workspace_id
    return NewsSource.model_validate(data)


def _source_applies_to_symbol(source: NewsSource, symbol: str) -> bool:
    scope = {item.upper() for item in source.scope}
    return "ALL" in scope or symbol.upper() in scope


def _source_window_start(
    start_date: str,
    end_date: str,
    source: NewsSource,
    policy: dict[str, Any],
) -> str:
    if source.category != "official_project":
        return start_date
    end = _date_from_iso(end_date)
    if end is None:
        return start_date
    lookback_days = max(int(policy.get("official_source_lookback_days", 30)), 0)
    if lookback_days <= 0:
        return start_date
    extended = end - timedelta(days=lookback_days)
    configured = _date_from_iso(start_date)
    if configured is not None and configured <= extended:
        return start_date
    return extended.isoformat()


def _coverage_group(source: NewsSource) -> str:
    if source.category == "aggregator" or source.evidence_type == "aggregator":
        return "aggregator"
    if source.workspace_id:
        return "workspace_sources"
    return "default_sources"


def _init_coverage(sources: list[NewsSource]) -> dict[str, int]:
    counts = {
        "default_sources": 0,
        "workspace_sources": 0,
        "aggregator": 0,
    }
    for source in sources:
        counts[_coverage_group(source)] += 1
    return counts


def _source_health(
    *,
    source: NewsSource,
    fetch_status: str,
    parse_status: str,
    raw_count: int,
    parsed_count: int,
    accepted_count: int,
    rejected_count: int,
    rejection_reasons: dict[str, int],
    error_code: str | None = None,
    error_message: str | None = None,
) -> NewsSourceHealth:
    return NewsSourceHealth(
        source_id=source.id,
        fetch_status=fetch_status,
        parse_status=parse_status,
        raw_count=raw_count,
        parsed_count=parsed_count,
        accepted_count=accepted_count,
        rejected_count=rejected_count,
        rejection_reasons={
            key: value for key, value in rejection_reasons.items() if value
        },
        error_code=error_code,
        error_message=error_message,
    )


def _bump_reason(counts: dict[str, int], reason: str) -> None:
    counts[reason] = counts.get(reason, 0) + 1


def _materiality_for_items(
    items: list[NewsItem],
    source_health: list[NewsSourceHealth],
) -> NewsMateriality:
    if items:
        return NewsMateriality(status="material_news_found")
    if _has_only_stale_window_rejections(source_health):
        return NewsMateriality(status="unknown")
    if any(
        health.fetch_status == "fetched"
        and health.parse_status == "parsed"
        and health.parsed_count > 0
        for health in source_health
    ):
        return NewsMateriality(status="no_material_news_found")
    return NewsMateriality(status="unknown")


def _has_only_stale_window_rejections(
    source_health: list[NewsSourceHealth],
) -> bool:
    parsed_health = [
        health
        for health in source_health
        if health.fetch_status == "fetched"
        and health.parse_status == "parsed"
        and health.parsed_count > 0
    ]
    if not parsed_health:
        return False

    parsed_count = sum(health.parsed_count for health in parsed_health)
    accepted_count = sum(health.accepted_count for health in parsed_health)
    stale_count = 0
    for health in parsed_health:
        stale_count += health.rejection_reasons.get("out_of_window", 0)
        if any(
            reason != "out_of_window" and count
            for reason, count in health.rejection_reasons.items()
        ):
            return False
    return accepted_count == 0 and stale_count > 0 and stale_count == parsed_count


def _build_coverage(
    source_counts: dict[str, int],
    failures: dict[str, list[str]],
    successes: dict[str, list[str]],
    items: list[NewsItem],
) -> NewsCoverage:
    relevant_by_group: defaultdict[str, int] = defaultdict(int)
    for item in items:
        if item.evidence_type == "aggregator":
            relevant_by_group["aggregator"] += 1
        elif item.evidence_type == "user_configured_source":
            relevant_by_group["workspace_sources"] += 1
        else:
            relevant_by_group["default_sources"] += 1

    statuses: dict[str, str] = {}
    for group in ("default_sources", "workspace_sources", "aggregator"):
        if source_counts[group] == 0:
            statuses[group] = "skipped"
        elif relevant_by_group[group]:
            statuses[group] = "clean" if not failures.get(group) else "degraded"
        elif failures.get(group) and not successes.get(group):
            statuses[group] = "failed"
        else:
            statuses[group] = "degraded"
    return NewsCoverage(
        default_sources=statuses["default_sources"],
        workspace_sources=statuses["workspace_sources"],
        targeted_search="skipped",
        aggregator=statuses["aggregator"],
    )


def _build_quality(
    items: list[NewsItem],
    failures: dict[str, list[str]],
    coverage: NewsCoverage,
    *,
    source_health: list[NewsSourceHealth],
    materiality: NewsMateriality,
) -> NewsQuality:
    if not items:
        active_coverage = [
            value
            for value in coverage.model_dump().values()
            if value not in {"skipped"}
        ]
        all_active_failed = bool(active_coverage) and all(
            value == "failed" for value in active_coverage
        )
        any_source_failed = any(
            health.fetch_status == "failed" or health.parse_status == "failed"
            for health in source_health
        )
        if _has_only_stale_window_rejections(source_health):
            return NewsQuality(
                status="degraded",
                score=0.5,
                reason_codes=["stale_news_window"],
            )
        if materiality.status == "no_material_news_found" and not all_active_failed:
            if any_source_failed:
                return NewsQuality(
                    status="degraded",
                    score=0.62,
                    reason_codes=["workspace_news_source_unavailable"],
                )
            return NewsQuality(status="clean", score=0.82, reason_codes=[])
        reason_codes = ["insufficient_news_evidence"]
        if all_active_failed or any_source_failed:
            reason_codes.insert(0, "missing_news_feed")
        return NewsQuality(
            status="insufficient_data",
            score=0.0,
            reason_codes=_dedupe(reason_codes),
        )

    primary_items = [
        item
        for item in items
        if item.evidence_type
        in {"primary_source", "official_source", "user_configured_source"}
    ]
    max_score = max(item.relevance_score for item in items)
    codes: list[str] = []
    status = "clean"
    if not primary_items:
        if all(item.evidence_type == "aggregator" for item in items):
            status = "degraded"
            codes.append("aggregator_only_news")
        elif all(item.evidence_type == "search_result" for item in items):
            status = "degraded"
            codes.append("search_only_news")
    if any(value == "failed" for value in coverage.model_dump().values()):
        status = "degraded"
        codes.append("workspace_news_source_unavailable")
    if max_score < 0.45:
        status = "degraded"
        codes.append("low_relevance_news")
    return NewsQuality(
        status=status, score=round(max_score, 2), reason_codes=_dedupe(codes)
    )


def _missing_data_for_quality(quality: NewsQuality) -> list[str]:
    if quality.status == "clean":
        return []
    if not quality.reason_codes:
        return ["news_context_degraded"]
    return list(quality.reason_codes)


def _to_news_item(
    entry: dict[str, Any],
    *,
    source: NewsSource,
    profile: AssetNewsProfile,
    fetched_at: str,
    match: dict[str, Any],
    end_date: str,
) -> NewsItem:
    tags = _catalyst_tags(entry["title"], entry.get("summary"))
    canonical_url = canonicalize_url(entry["url"])
    trust = _trust_score(source)
    freshness = _freshness_score(entry["published_at"], end_date)
    relevance = _relevance_score(
        trust=trust,
        freshness=freshness,
        match=match,
        has_catalyst=bool(tags),
        source=source,
        url=canonical_url,
        profile=profile,
    )
    return NewsItem(
        title=entry["title"],
        url=entry["url"],
        canonical_url=canonical_url,
        source_id=source.id,
        source_name=source.name,
        source_category=source.category,
        trust_tier=source.trust_tier,
        published_at=entry["published_at"],
        fetched_at=fetched_at,
        summary=entry.get("summary"),
        author=entry.get("author"),
        matched_assets=[profile.symbol],
        catalyst_tags=tags,
        relevance_score=relevance,
        source_trust_score=trust,
        freshness_score=freshness,
        evidence_type=source.evidence_type,
    )


def _parse_feed(
    raw_feed: str, source: NewsSource, *, fetched_at: str
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    del fetched_at
    root = ET.fromstring(raw_feed)
    root_name = _local_name(root.tag)
    entries: list[ET.Element]
    if root_name == "rss":
        channel = _first_child(root, "channel") or root
        entries = _children(channel, "item")
    else:
        entries = _children(root, "entry")
    parsed: list[dict[str, Any]] = []
    rejection_reasons: dict[str, int] = {}
    for entry in entries:
        title = _first_text(entry, "title")
        url = _entry_url(entry)
        published_raw = (
            _first_text(entry, "pubDate")
            or _first_text(entry, "published")
            or _first_text(entry, "updated")
            or _first_text(entry, "date")
        )
        published_at = _parse_timestamp(published_raw)
        if not title:
            _bump_reason(rejection_reasons, "missing_title")
            continue
        if not url:
            _bump_reason(rejection_reasons, "missing_url")
            continue
        if not published_at:
            _bump_reason(rejection_reasons, "missing_published_at")
            continue
        parsed.append(
            {
                "title": _clean_text(title),
                "url": url.strip(),
                "published_at": published_at,
                "summary": _clean_text(
                    _first_text(entry, "description")
                    or _first_text(entry, "summary")
                    or _first_text(entry, "content")
                    or ""
                )
                or None,
                "author": _first_text(entry, "author"),
                "source_id": source.id,
            }
        )
    return parsed, len(entries), rejection_reasons


def _parse_html_list(
    raw_html: str,
    source: NewsSource,
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    from parsel import Selector

    selectors = dict(source.selectors or {})
    required = ("item", "title", "link", "date")
    if any(not selectors.get(key) for key in required):
        raise ValueError("html source requires item/title/link/date selectors")

    root = Selector(text=raw_html)
    nodes = root.css(selectors["item"])
    parsed: list[dict[str, Any]] = []
    rejection_reasons: dict[str, int] = {}
    for node in nodes:
        title = _clean_text(" ".join(node.css(selectors["title"] + "::text").getall()))
        href = node.css(selectors["link"] + "::attr(href)").get()
        date_text = node.css(selectors["date"] + "::attr(datetime)").get() or " ".join(
            node.css(selectors["date"] + "::text").getall()
        )
        published_at = _parse_timestamp(date_text)
        if not title:
            _bump_reason(rejection_reasons, "missing_title")
            continue
        if not href:
            _bump_reason(rejection_reasons, "missing_url")
            continue
        if not published_at:
            _bump_reason(rejection_reasons, "missing_published_at")
            continue
        parsed.append(
            {
                "title": title,
                "url": urllib.parse.urljoin(source.url, href.strip()),
                "published_at": published_at,
                "summary": None,
                "author": None,
                "source_id": source.id,
            }
        )
    return parsed, len(nodes), rejection_reasons


def _entry_url(entry: ET.Element) -> str | None:
    link_text = _first_text(entry, "link")
    if link_text:
        return link_text
    for child in _children(entry, "link"):
        href = child.attrib.get("href")
        if href:
            return href
    return None


def _first_child(node: ET.Element, name: str) -> ET.Element | None:
    for child in list(node):
        if _local_name(child.tag) == name:
            return child
    return None


def _children(node: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(node) if _local_name(child.tag) == name]


def _first_text(node: ET.Element, name: str) -> str | None:
    child = _first_child(node, name)
    if child is None:
        return None
    if _local_name(child.tag) == "author":
        nested = _first_text(child, "name")
        if nested:
            return nested
    return child.text.strip() if child.text else None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (
        parsed.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _within_window(published_at: str, start: str, end: str) -> bool:
    published = _date_from_iso(published_at)
    start_date = _date_from_iso(start)
    end_date = _date_from_iso(end)
    if published is None:
        return False
    if start_date and published < start_date:
        return False
    if end_date and published > end_date:
        return False
    return True


def _date_from_iso(value: str) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None


def _match_asset(
    profile: AssetNewsProfile,
    title: str,
    summary: str | None,
    url: str,
) -> dict[str, Any] | None:
    text = f"{title} {summary or ''} {url}".lower()
    aliases = [profile.canonical_name, *profile.aliases]
    best = ""
    for alias in aliases:
        alias = alias.strip()
        if not alias:
            continue
        if _contains_term(text, alias.lower()):
            best = alias
            break
    if best:
        return {
            "type": "alias",
            "exact_name": best.lower() != profile.symbol.lower(),
            "ambiguous_symbol": False,
        }
    symbol_hit = _contains_symbol(text, profile.symbol)
    if not symbol_hit:
        return None
    disambiguated = any(term.lower() in text for term in profile.disambiguation_terms)
    if profile.symbol_only_match_allowed or disambiguated:
        return {
            "type": "symbol",
            "exact_name": False,
            "ambiguous_symbol": not disambiguated,
        }
    return None


def _contains_term(text: str, term: str) -> bool:
    if not term:
        return False
    pattern = r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])"
    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def _contains_symbol(text: str, symbol: str) -> bool:
    pattern = r"(?<![A-Z0-9])" + re.escape(symbol.upper()) + r"(?![A-Z0-9])"
    return re.search(pattern, text.upper()) is not None


def _catalyst_tags(title: str, summary: str | None) -> list[str]:
    text = f"{title} {summary or ''}".lower()
    tags = []
    for tag, keywords in CATALYST_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            tags.append(tag)
    return _dedupe(tags)


def _trust_score(source: NewsSource) -> float:
    tier = source.trust_tier.strip().lower()
    if source.category == "aggregator":
        tier = "aggregator"
    score = TRUST_SCORES.get(tier, TRUST_SCORES["medium"])
    if source.official:
        score = min(1.0, score + 0.06)
    return round(score, 2)


def _freshness_score(published_at: str, end_date: str) -> float:
    published = _date_from_iso(published_at)
    end = _date_from_iso(end_date)
    if not published or not end:
        return 0.4
    age_days = max((end - published).days, 0)
    if age_days <= 1:
        return 0.95
    if age_days <= 3:
        return 0.75
    if age_days <= 7:
        return 0.55
    return 0.25


def _relevance_score(
    *,
    trust: float,
    freshness: float,
    match: dict[str, Any],
    has_catalyst: bool,
    source: NewsSource,
    url: str,
    profile: AssetNewsProfile,
) -> float:
    score = 0.22 + trust * 0.34 + freshness * 0.18
    if match.get("exact_name"):
        score += 0.18
    if source.official or _url_matches_domains(url, profile.official_domains):
        score += 0.08
    if has_catalyst:
        score += 0.1
    if source.category == "aggregator":
        score -= 0.18
    if match.get("ambiguous_symbol"):
        score -= 0.16
    return round(max(0.0, min(score, 1.0)), 2)


def _url_matches_domains(url: str, domains: list[str]) -> bool:
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
    except Exception:
        return False
    return any(
        host == domain.lower() or host.endswith("." + domain.lower())
        for domain in domains
    )


def _dedupe_items(items: list[NewsItem]) -> list[NewsItem]:
    by_key: dict[tuple[str, str], NewsItem] = {}
    for item in items:
        key = (item.canonical_url, _normalized_title(item.title))
        existing = by_key.get(key)
        if existing is None or item.relevance_score > existing.relevance_score:
            by_key[key] = item
    return list(by_key.values())


def _build_story_clusters(items: list[NewsItem]) -> list[NewsStoryCluster]:
    grouped: dict[str, list[NewsItem]] = defaultdict(list)
    for item in items:
        tag = _cluster_tag(item)
        grouped[tag].append(item)
    clusters = []
    for tag, group in grouped.items():
        lead = sorted(group, key=lambda item: item.relevance_score, reverse=True)[0]
        clusters.append(
            NewsStoryCluster(
                tag=tag,
                lead_title=lead.title,
                lead_source=lead.source_name,
                article_count=len(group),
                supporting_urls=[item.canonical_url for item in group],
            )
        )
    clusters.sort(key=lambda cluster: cluster.article_count, reverse=True)
    return clusters


def _cluster_tag(item: NewsItem) -> str:
    if any(tag in {"listing", "delisting"} for tag in item.catalyst_tags):
        return "exchange_listing_or_margin"
    return item.catalyst_tags[0] if item.catalyst_tags else item.source_category


def canonicalize_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    scheme = (parsed.scheme or "https").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))


def _normalized_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def _base_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().split("/")[0].split(":")[0] or "UNKNOWN"


def _slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_") or "source"


def _clean_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", without_tags).strip()


def _dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _fetch_url(url: str, timeout_sec: float) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LunaCrypto/0.3 news-context",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
