import pytest
from pydantic import ValidationError

from luna_workstation.domain.news_catalog import (
    HtmlParserConfig,
    SourcePack,
    SystemNewsSource,
    validate_source_packs,
)


def test_valid_rss_source_loads():
    source = SystemNewsSource.model_validate(
        {
            "id": "coinbase_blog",
            "name": "Coinbase Blog",
            "platform": "rss",
            "adapter_id": "rss_atom",
            "locator": "https://www.coinbase.com/blog/rss.xml",
            "category": "exchange_announcements",
            "trust_tier": "high",
            "official": True,
            "supported_symbols": ["all", "btc"],
            "freshness_hours": 6,
        }
    )

    assert source.supported_symbols == ["ALL", "BTC"]
    assert source.source_type == "news"


def test_html_source_requires_parser_config():
    with pytest.raises(ValidationError):
        SystemNewsSource.model_validate(
            {
                "id": "example_html",
                "name": "Example HTML",
                "platform": "html",
                "adapter_id": "html_list",
                "locator": "https://example.com/news",
                "category": "crypto_media",
                "trust_tier": "medium",
                "official": False,
                "supported_symbols": ["ALL"],
                "freshness_hours": 6,
            }
        )


def test_html_source_accepts_parser_config():
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
        parser_config=HtmlParserConfig(
            item_selector="article",
            title_selector="h2",
            link_selector="a",
        ),
    )

    assert source.parser_config is not None


def test_rss_source_requires_rss_atom_adapter():
    with pytest.raises(ValidationError):
        SystemNewsSource.model_validate(
            {
                "id": "bad_rss",
                "name": "Bad RSS",
                "platform": "rss",
                "adapter_id": "html_list",
                "locator": "https://example.com/feed.xml",
                "category": "crypto_media",
                "trust_tier": "medium",
                "official": False,
                "supported_symbols": ["ALL"],
                "freshness_hours": 6,
            }
        )


def test_source_pack_references_must_exist():
    source = SystemNewsSource(
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
    )
    pack = SourcePack(
        id="pack_exchange_announcements",
        name="Exchange Announcements",
        description="Official exchange announcements.",
        category="exchange_announcements",
        source_ids=["coinbase_blog", "missing_source"],
        recommended_for=["ALL"],
        enabled_by_default=True,
    )

    with pytest.raises(ValueError, match="missing_source"):
        validate_source_packs([source], [pack])
