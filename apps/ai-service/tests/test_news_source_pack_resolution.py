import pytest

from luna_workstation.data.news_source_catalog import default_news_source_dicts
from luna_workstation.data.news_source_packs import (
    DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL,
    resolve_news_sources_for_workspace,
)


def test_resolve_default_exchange_pack_returns_catalog_sources():
    sources = resolve_news_sources_for_workspace(
        selected_pack_ids=["pack_exchange_announcements"],
        disabled_source_ids=[],
        symbol="BTC",
    )

    assert [source.id for source in sources] == [
        "binance_announcements",
        "coinbase_blog",
    ]


def test_seed_catalog_supports_btc_eth_and_bnb_workspaces():
    for symbol in ("BTC", "ETH", "BNB"):
        sources = resolve_news_sources_for_workspace(
            selected_pack_ids=[],
            disabled_source_ids=[],
            symbol=symbol,
        )
        assert any(
            source.scope == ["ALL"] or symbol in source.scope for source in sources
        )
        assert any(source.category == "exchange_announcements" for source in sources)
        assert any(source.category == "official_project" for source in sources)


def test_default_pack_ids_include_symbol_specific_official_pack():
    assert DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL["BTC"] == [
        "pack_exchange_announcements",
        "pack_regulatory_us",
        "pack_btc_official",
    ]
    assert DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL["ETH"][-1] == "pack_eth_official"
    assert DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL["BNB"][-1] == "pack_bnb_official"


def test_legacy_default_source_dicts_match_shared_default_packs():
    assert [source["id"] for source in default_news_source_dicts()] == [
        "binance_announcements",
        "coinbase_blog",
        "sec_press_releases",
    ]


def test_unknown_source_pack_is_rejected():
    with pytest.raises(ValueError, match="unknown_pack"):
        resolve_news_sources_for_workspace(
            selected_pack_ids=["unknown_pack"],
            disabled_source_ids=[],
            symbol="BTC",
        )


def test_disabled_source_override_removes_catalog_source():
    sources = resolve_news_sources_for_workspace(
        selected_pack_ids=["pack_exchange_announcements"],
        disabled_source_ids=["coinbase_blog"],
        symbol="BTC",
    )

    assert [source.id for source in sources] == ["binance_announcements"]
