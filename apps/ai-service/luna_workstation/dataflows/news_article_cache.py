"""In-process news article cache used by catalog ingestion."""

from __future__ import annotations

import hashlib
from datetime import date, datetime

from pydantic import BaseModel, field_validator


class CachedNewsArticle(BaseModel):
    id: str
    source_id: str
    source_url: str
    article_url: str
    canonical_url: str
    title: str
    published_at: str
    first_seen_at: str
    last_seen_at: str
    fetched_at: str
    content_hash: str
    summary: str | None = None
    raw_excerpt: str | None = None

    @field_validator(
        "id",
        "source_id",
        "source_url",
        "article_url",
        "canonical_url",
        "title",
        "published_at",
        "first_seen_at",
        "last_seen_at",
        "fetched_at",
        "content_hash",
    )
    @classmethod
    def _normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field must not be blank")
        return normalized


class InMemoryNewsArticleCache:
    def __init__(self) -> None:
        self._articles_by_key: dict[tuple[str, str], CachedNewsArticle] = {}

    def upsert_many(self, articles: list[CachedNewsArticle]) -> None:
        for article in articles:
            key = (article.source_id, article.canonical_url)
            existing = self._articles_by_key.get(key)
            if existing is None:
                self._articles_by_key[key] = article
                continue
            self._articles_by_key[key] = article.model_copy(
                update={
                    "id": existing.id,
                    "first_seen_at": existing.first_seen_at,
                    "last_seen_at": article.last_seen_at,
                    "fetched_at": article.fetched_at,
                    "content_hash": article.content_hash,
                }
            )

    def query(
        self,
        *,
        source_ids: list[str],
        window_start: str | None = None,
        window_end: str | None = None,
    ) -> list[CachedNewsArticle]:
        source_id_set = set(source_ids)
        articles = [
            article
            for article in self._articles_by_key.values()
            if not source_id_set or article.source_id in source_id_set
        ]
        if window_start or window_end:
            articles = [
                article
                for article in articles
                if _within_window(article.published_at, window_start, window_end)
            ]
        return sorted(articles, key=lambda article: article.published_at, reverse=True)


def stable_article_id(source_id: str, canonical_url: str) -> str:
    digest = hashlib.sha256(f"{source_id}:{canonical_url}".encode("utf-8")).hexdigest()[
        :24
    ]
    return f"{source_id}_{digest}"


def _within_window(
    published_at: str,
    window_start: str | None,
    window_end: str | None,
) -> bool:
    published = _date_from_iso(published_at)
    start = _date_from_iso(window_start)
    end = _date_from_iso(window_end)
    if published is None:
        return False
    if start is not None and published < start:
        return False
    if end is not None and published > end:
        return False
    return True


def _date_from_iso(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
