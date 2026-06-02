from luna_workstation.data.news_source_catalog import SYSTEM_NEWS_SOURCE_BY_ID
from luna_workstation.dataflows.news_article_cache import InMemoryNewsArticleCache
from luna_workstation.dataflows.news_ingestion_job import ingest_news_sources


def test_ingestion_records_healthy_source_and_writes_cache():
    cache = InMemoryNewsArticleCache()

    result = ingest_news_sources(
        sources=[SYSTEM_NEWS_SOURCE_BY_ID["binance_announcements"]],
        fetcher=lambda _url, _timeout: rss_feed_with_item(),
        cache=cache,
        now_fn=lambda: "2026-06-03T00:05:00Z",
    )

    assert result.source_health[0].fetch_status == "fetched"
    assert result.source_health[0].parse_status == "parsed"
    assert result.source_health[0].parsed_count == 1
    assert cache.query(source_ids=["binance_announcements"])[0].title == (
        "Binance lists ETH example market"
    )


def test_ingestion_records_empty_healthy_source():
    result = ingest_news_sources(
        sources=[SYSTEM_NEWS_SOURCE_BY_ID["sec_press_releases"]],
        fetcher=lambda _url, _timeout: rss_feed_with_no_items(),
        cache=InMemoryNewsArticleCache(),
        now_fn=lambda: "2026-06-03T00:00:00Z",
    )

    assert result.source_health[0].fetch_status == "fetched"
    assert result.source_health[0].parse_status == "empty"
    assert result.source_health[0].parsed_count == 0


def test_ingestion_records_fetch_failure():
    result = ingest_news_sources(
        sources=[SYSTEM_NEWS_SOURCE_BY_ID["coinbase_blog"]],
        fetcher=lambda _url, _timeout: (_ for _ in ()).throw(RuntimeError("down")),
        cache=InMemoryNewsArticleCache(),
        now_fn=lambda: "2026-06-03T00:00:00Z",
    )

    assert result.source_health[0].fetch_status == "failed"
    assert result.source_health[0].parse_status == "skipped"
    assert result.source_health[0].last_failure_at == "2026-06-03T00:00:00Z"
    assert result.source_health[0].error_code == "fetch_failed"


def test_ingestion_records_parse_failure():
    result = ingest_news_sources(
        sources=[SYSTEM_NEWS_SOURCE_BY_ID["coinbase_blog"]],
        fetcher=lambda _url, _timeout: "<rss><broken>",
        cache=InMemoryNewsArticleCache(),
        now_fn=lambda: "2026-06-03T00:00:00Z",
    )

    assert result.source_health[0].fetch_status == "fetched"
    assert result.source_health[0].parse_status == "failed"
    assert result.source_health[0].error_code == "parse_failed"


def test_ingestion_dedupes_articles_before_cache_write():
    cache = InMemoryNewsArticleCache()

    result = ingest_news_sources(
        sources=[SYSTEM_NEWS_SOURCE_BY_ID["binance_announcements"]],
        fetcher=lambda _url, _timeout: rss_feed_with_duplicate_items(),
        cache=cache,
        now_fn=lambda: "2026-06-03T00:05:00Z",
    )

    assert result.source_health[0].raw_count == 2
    assert result.source_health[0].parsed_count == 1
    assert len(cache.query(source_ids=["binance_announcements"])) == 1


def rss_feed_with_item() -> str:
    return """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Binance lists ETH example market</title>
            <link>https://example.com/eth-listing?utm_source=rss</link>
            <pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate>
            <description>Exchange announcement mentioning ETH.</description>
          </item>
        </channel></rss>"""


def rss_feed_with_no_items() -> str:
    return """<?xml version="1.0"?><rss><channel></channel></rss>"""


def rss_feed_with_duplicate_items() -> str:
    return """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Binance lists ETH example market</title>
            <link>https://example.com/eth-listing?utm_source=rss</link>
            <pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Binance lists ETH example market</title>
            <link>https://example.com/eth-listing</link>
            <pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate>
          </item>
        </channel></rss>"""
