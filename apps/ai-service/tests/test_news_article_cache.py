import pytest

from luna_workstation.data.news_source_catalog import SYSTEM_NEWS_SOURCE_BY_ID
from luna_workstation.dataflows.news_adapters import adapter_for
from luna_workstation.dataflows.news_article_cache import (
    CachedNewsArticle,
    InMemoryNewsArticleCache,
)
from luna_workstation.domain.news_catalog import SystemNewsSource


def test_rss_adapter_normalizes_feed_entries():
    source = SYSTEM_NEWS_SOURCE_BY_ID["binance_announcements"]
    feed = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Binance lists ETH example market</title>
            <link>https://example.com/eth-listing?utm_source=rss</link>
            <pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate>
            <description>Exchange announcement mentioning ETH.</description>
          </item>
        </channel></rss>"""

    articles = adapter_for(source).discover(
        source=source,
        fetcher=lambda _url, _timeout: feed,
        timeout_sec=5.0,
        fetched_at="2026-06-03T00:05:00Z",
    )

    assert len(articles) == 1
    assert articles[0].source_id == "binance_announcements"
    assert articles[0].canonical_url == "https://example.com/eth-listing"
    assert articles[0].published_at == "2026-06-03T00:00:00Z"
    assert articles[0].content_hash


def test_html_adapter_requires_parser_config_before_fetch():
    source = SystemNewsSource(
        id="example_html",
        name="Example HTML",
        platform="html",
        adapter_id="html_list",
        locator="https://example.com/news",
        category="crypto_media",
        trust_tier="medium",
        official=False,
        supported_symbols=["ALL"],
        freshness_hours=6,
        parser_config={
            "item_selector": "article",
            "title_selector": "h2",
            "link_selector": "a",
        },
    ).model_copy(update={"parser_config": None})

    with pytest.raises(ValueError, match="parser_config"):
        adapter_for(source).discover(
            source=source,
            fetcher=lambda _url, _timeout: pytest.fail("fetcher should not run"),
            timeout_sec=5.0,
            fetched_at="2026-06-03T00:05:00Z",
        )


def test_article_cache_upserts_by_source_and_canonical_url():
    cache = InMemoryNewsArticleCache()
    first = CachedNewsArticle(
        id="binance_announcements_https_example_com_eth_listing",
        source_id="binance_announcements",
        source_url="https://www.binance.com/en/support/announcement/rss",
        article_url="https://example.com/eth-listing",
        canonical_url="https://example.com/eth-listing",
        title="Binance lists ETH example market",
        published_at="2026-06-03T00:00:00Z",
        first_seen_at="2026-06-03T00:05:00Z",
        last_seen_at="2026-06-03T00:05:00Z",
        fetched_at="2026-06-03T00:05:00Z",
        content_hash="hash_001",
        summary="Exchange announcement mentioning ETH.",
    )
    second = first.model_copy(update={"fetched_at": "2026-06-03T01:00:00Z"})

    cache.upsert_many([first])
    cache.upsert_many([second])

    assert len(cache.query(source_ids=["binance_announcements"])) == 1
    assert cache.query(source_ids=["binance_announcements"])[0].fetched_at == (
        "2026-06-03T01:00:00Z"
    )


def test_article_cache_filters_by_source_and_window():
    cache = InMemoryNewsArticleCache()
    cache.upsert_many(
        [
            CachedNewsArticle(
                id="old",
                source_id="coindesk",
                source_url="https://example.com/rss",
                article_url="https://example.com/old",
                canonical_url="https://example.com/old",
                title="Old Bitcoin news",
                published_at="2026-05-01T00:00:00Z",
                first_seen_at="2026-05-01T00:01:00Z",
                last_seen_at="2026-05-01T00:01:00Z",
                fetched_at="2026-05-01T00:01:00Z",
                content_hash="hash_old",
            ),
            CachedNewsArticle(
                id="fresh",
                source_id="coindesk",
                source_url="https://example.com/rss",
                article_url="https://example.com/fresh",
                canonical_url="https://example.com/fresh",
                title="Fresh Bitcoin news",
                published_at="2026-06-03T00:00:00Z",
                first_seen_at="2026-06-03T00:01:00Z",
                last_seen_at="2026-06-03T00:01:00Z",
                fetched_at="2026-06-03T00:01:00Z",
                content_hash="hash_fresh",
            ),
        ]
    )

    results = cache.query(
        source_ids=["coindesk"],
        window_start="2026-06-01",
        window_end="2026-06-04",
    )

    assert [article.id for article in results] == ["fresh"]
