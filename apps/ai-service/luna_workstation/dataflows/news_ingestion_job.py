"""Background-style ingestion for system catalog news sources."""

from __future__ import annotations

from typing import Callable, Literal

from pydantic import BaseModel

from luna_workstation.dataflows.news_adapters import RawDiscoveredArticle, adapter_for
from luna_workstation.dataflows.news_article_cache import (
    CachedNewsArticle,
    InMemoryNewsArticleCache,
    stable_article_id,
)
from luna_workstation.domain.news_catalog import SystemNewsSource

FeedFetcher = Callable[[str, float], str]


class NewsSourceHealth(BaseModel):
    source_id: str
    fetch_status: Literal["fetched", "failed", "skipped"]
    parse_status: Literal["parsed", "empty", "failed", "skipped"]
    raw_count: int = 0
    parsed_count: int = 0
    last_success_at: str | None = None
    last_failure_at: str | None = None
    error_code: str | None = None


class NewsIngestionResult(BaseModel):
    source_health: list[NewsSourceHealth]


def ingest_news_sources(
    *,
    sources: list[SystemNewsSource],
    fetcher: FeedFetcher,
    cache: InMemoryNewsArticleCache,
    now_fn: Callable[[], str],
    timeout_sec: float = 8.0,
) -> NewsIngestionResult:
    now = now_fn()
    source_health: list[NewsSourceHealth] = []
    for source in sources:
        fetched = False

        def recording_fetcher(url: str, timeout: float) -> str:
            nonlocal fetched
            raw = fetcher(url, timeout)
            fetched = True
            return raw

        try:
            raw_articles = adapter_for(source).discover(
                source=source,
                fetcher=recording_fetcher,
                timeout_sec=timeout_sec,
                fetched_at=now,
            )
        except Exception:
            if fetched:
                source_health.append(
                    NewsSourceHealth(
                        source_id=source.id,
                        fetch_status="fetched",
                        parse_status="failed",
                        last_failure_at=now,
                        error_code="parse_failed",
                    )
                )
            else:
                source_health.append(
                    NewsSourceHealth(
                        source_id=source.id,
                        fetch_status="failed",
                        parse_status="skipped",
                        last_failure_at=now,
                        error_code="fetch_failed",
                    )
                )
            continue

        deduped_raw = _dedupe_raw_articles(raw_articles)
        cached_articles = [
            _cached_article_from_raw(article, now) for article in deduped_raw
        ]
        cache.upsert_many(cached_articles)
        source_health.append(
            NewsSourceHealth(
                source_id=source.id,
                fetch_status="fetched",
                parse_status="parsed" if cached_articles else "empty",
                raw_count=len(raw_articles),
                parsed_count=len(cached_articles),
                last_success_at=now,
            )
        )
    return NewsIngestionResult(source_health=source_health)


def _cached_article_from_raw(
    article: RawDiscoveredArticle,
    now: str,
) -> CachedNewsArticle:
    return CachedNewsArticle(
        id=stable_article_id(article.source_id, article.canonical_url),
        source_id=article.source_id,
        source_url=article.source_url,
        article_url=article.article_url,
        canonical_url=article.canonical_url,
        title=article.title,
        published_at=article.published_at,
        first_seen_at=now,
        last_seen_at=now,
        fetched_at=article.fetched_at,
        content_hash=article.content_hash,
        summary=article.summary,
        raw_excerpt=article.summary,
    )


def _dedupe_raw_articles(
    articles: list[RawDiscoveredArticle],
) -> list[RawDiscoveredArticle]:
    by_key: dict[tuple[str, str], RawDiscoveredArticle] = {}
    for article in articles:
        key = (article.source_id, article.canonical_url)
        by_key.setdefault(key, article)
    return list(by_key.values())
