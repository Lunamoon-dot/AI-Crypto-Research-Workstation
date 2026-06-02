"""News source adapter registry for catalog ingestion."""

from __future__ import annotations

import hashlib
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Protocol

from pydantic import BaseModel

from luna_workstation.domain.news_catalog import SystemNewsSource

FeedFetcher = Callable[[str, float], str]


class RawDiscoveredArticle(BaseModel):
    source_id: str
    source_url: str
    article_url: str
    canonical_url: str
    title: str
    published_at: str
    summary: str | None = None
    fetched_at: str
    content_hash: str


class NewsSourceAdapter(Protocol):
    def discover(
        self,
        *,
        source: SystemNewsSource,
        fetcher: FeedFetcher,
        timeout_sec: float,
        fetched_at: str,
    ) -> list[RawDiscoveredArticle]: ...


class RssAtomAdapter:
    def discover(
        self,
        *,
        source: SystemNewsSource,
        fetcher: FeedFetcher,
        timeout_sec: float,
        fetched_at: str,
    ) -> list[RawDiscoveredArticle]:
        raw_feed = fetcher(source.locator, timeout_sec)
        root = ET.fromstring(raw_feed)
        root_name = _local_name(root.tag)
        if root_name == "rss":
            channel = _first_child(root, "channel") or root
            entries = _children(channel, "item")
        else:
            entries = _children(root, "entry")

        articles: list[RawDiscoveredArticle] = []
        for entry in entries:
            title = _first_text(entry, "title")
            article_url = _entry_url(entry)
            published_at = _parse_timestamp(
                _first_text(entry, "pubDate")
                or _first_text(entry, "published")
                or _first_text(entry, "updated")
                or _first_text(entry, "date")
            )
            if not title or not article_url or not published_at:
                continue
            summary = _clean_text(
                _first_text(entry, "description")
                or _first_text(entry, "summary")
                or _first_text(entry, "content")
                or ""
            )
            canonical_url = canonicalize_url(article_url)
            articles.append(
                RawDiscoveredArticle(
                    source_id=source.id,
                    source_url=source.locator,
                    article_url=article_url.strip(),
                    canonical_url=canonical_url,
                    title=_clean_text(title),
                    published_at=published_at,
                    summary=summary or None,
                    fetched_at=fetched_at,
                    content_hash=_content_hash(title, canonical_url, summary),
                )
            )
        return articles


class HtmlListAdapter:
    def discover(
        self,
        *,
        source: SystemNewsSource,
        fetcher: FeedFetcher,
        timeout_sec: float,
        fetched_at: str,
    ) -> list[RawDiscoveredArticle]:
        del fetcher, timeout_sec, fetched_at
        if source.parser_config is None:
            raise ValueError(f"HTML source {source.id} requires parser_config")
        return []


class JsonApiAdapter:
    def discover(
        self,
        *,
        source: SystemNewsSource,
        fetcher: FeedFetcher,
        timeout_sec: float,
        fetched_at: str,
    ) -> list[RawDiscoveredArticle]:
        del source, fetcher, timeout_sec, fetched_at
        return []


def adapter_for(source: SystemNewsSource) -> NewsSourceAdapter:
    if source.adapter_id == "rss_atom":
        return RssAtomAdapter()
    if source.adapter_id == "html_list":
        return HtmlListAdapter()
    if source.adapter_id == "json_api":
        return JsonApiAdapter()
    raise ValueError(f"Unsupported news adapter: {source.adapter_id}")


def canonicalize_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    scheme = (parsed.scheme or "https").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((scheme, netloc, path, "", "", ""))


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


def _content_hash(title: str, canonical_url: str, summary: str | None) -> str:
    content = f"{title}\n{canonical_url}\n{summary or ''}"
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _clean_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", without_tags).strip()
