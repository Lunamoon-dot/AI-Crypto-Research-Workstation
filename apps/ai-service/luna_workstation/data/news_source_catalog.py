"""Seed system news source catalog."""

from __future__ import annotations

from luna_workstation.domain.news_catalog import SystemNewsSource
from luna_workstation.domain.news_context import NewsSource


SYSTEM_NEWS_SOURCES: tuple[SystemNewsSource, ...] = (
    SystemNewsSource(
        id="binance_announcements",
        name="Binance Announcements",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.binance.com/en/support/announcement/rss",
        category="exchange_announcements",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=1,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="coinbase_blog",
        name="Coinbase Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.coinbase.com/blog/rss.xml",
        category="exchange_announcements",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=6,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="sec_press_releases",
        name="SEC Press Releases",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.sec.gov/news/pressreleases.rss",
        category="regulatory",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=24,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="coindesk",
        name="CoinDesk",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.coindesk.com/arc/outboundfeeds/rss/",
        category="crypto_media",
        trust_tier="medium",
        official=False,
        supported_symbols=["ALL"],
        freshness_hours=6,
    ),
    SystemNewsSource(
        id="bitcoin_core_blog",
        name="Bitcoin Core Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://bitcoincore.org/en/rss.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["BTC"],
        freshness_hours=168,
    ),
    SystemNewsSource(
        id="ethereum_blog",
        name="Ethereum Foundation Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://blog.ethereum.org/feed.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["ETH"],
        freshness_hours=168,
    ),
    SystemNewsSource(
        id="bnb_chain_blog",
        name="BNB Chain Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.bnbchain.org/en/blog/rss.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["BNB"],
        freshness_hours=168,
    ),
)

SYSTEM_NEWS_SOURCE_BY_ID = {source.id: source for source in SYSTEM_NEWS_SOURCES}


def system_source_to_news_source(source: SystemNewsSource) -> NewsSource:
    return NewsSource(
        id=source.id,
        name=source.name,
        type=source.platform,
        url=source.locator,
        category=source.category,
        trust_tier=source.trust_tier,
        target_analysts=["news"],
        scope=source.supported_symbols,
        official=source.official,
    )


def default_news_source_dicts() -> tuple[dict[str, object], ...]:
    return tuple(
        system_source_to_news_source(source).model_dump()
        for source in SYSTEM_NEWS_SOURCES
        if source.enabled_by_default
    )
