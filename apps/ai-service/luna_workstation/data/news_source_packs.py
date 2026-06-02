"""Default source pack definitions and workspace resolution."""

from __future__ import annotations

from luna_workstation.data.news_source_catalog import (
    SYSTEM_NEWS_SOURCE_BY_ID,
    SYSTEM_NEWS_SOURCES,
    system_source_to_news_source,
)
from luna_workstation.domain.news_catalog import SourcePack, validate_source_packs
from luna_workstation.domain.news_context import NewsSource


SYSTEM_SOURCE_PACKS: tuple[SourcePack, ...] = (
    SourcePack(
        id="pack_exchange_announcements",
        name="Exchange Announcements",
        description=(
            "Official exchange listing, delisting, maintenance, margin, and "
            "futures updates."
        ),
        category="exchange_announcements",
        source_ids=["binance_announcements", "coinbase_blog"],
        recommended_for=["ALL"],
        enabled_by_default=True,
    ),
    SourcePack(
        id="pack_regulatory_us",
        name="US Regulatory",
        description=(
            "US regulator press releases and enforcement updates relevant to "
            "crypto assets."
        ),
        category="regulatory",
        source_ids=["sec_press_releases"],
        recommended_for=["ALL"],
        enabled_by_default=True,
    ),
    SourcePack(
        id="pack_core_crypto_media",
        name="Core Crypto Media",
        description="Reputable crypto media coverage for broad market context.",
        category="crypto_media",
        source_ids=["coindesk"],
        recommended_for=["ALL"],
        enabled_by_default=False,
    ),
    SourcePack(
        id="pack_btc_official",
        name="BTC Official Sources",
        description="Bitcoin protocol and ecosystem sources for BTC workspaces.",
        category="official_project",
        source_ids=["bitcoin_core_blog"],
        recommended_for=["BTC"],
    ),
    SourcePack(
        id="pack_eth_official",
        name="ETH Official Sources",
        description="Ethereum Foundation and protocol sources for ETH workspaces.",
        category="official_project",
        source_ids=["ethereum_blog"],
        recommended_for=["ETH"],
    ),
    SourcePack(
        id="pack_bnb_official",
        name="BNB Official Sources",
        description="BNB Chain official updates for BNB workspaces.",
        category="official_project",
        source_ids=["bnb_chain_blog"],
        recommended_for=["BNB"],
    ),
)

validate_source_packs(SYSTEM_NEWS_SOURCES, SYSTEM_SOURCE_PACKS)

SYSTEM_SOURCE_PACK_BY_ID = {pack.id: pack for pack in SYSTEM_SOURCE_PACKS}
DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL: dict[str, list[str]] = {
    "BTC": [
        "pack_exchange_announcements",
        "pack_regulatory_us",
        "pack_btc_official",
    ],
    "ETH": [
        "pack_exchange_announcements",
        "pack_regulatory_us",
        "pack_eth_official",
    ],
    "BNB": [
        "pack_exchange_announcements",
        "pack_regulatory_us",
        "pack_bnb_official",
    ],
}
DEFAULT_SOURCE_PACK_IDS = [
    pack.id
    for pack in SYSTEM_SOURCE_PACKS
    if pack.enabled_by_default and "ALL" in pack.recommended_for
]


def resolve_source_pack_ids_for_symbol(
    *,
    selected_pack_ids: list[str] | tuple[str, ...] | None,
    symbol: str,
) -> list[str]:
    if selected_pack_ids:
        pack_ids = [pack_id for pack_id in selected_pack_ids if pack_id]
    else:
        base_symbol = _base_symbol(symbol)
        pack_ids = DEFAULT_SOURCE_PACK_IDS_BY_SYMBOL.get(
            base_symbol,
            list(DEFAULT_SOURCE_PACK_IDS),
        )
    unknown = [
        pack_id for pack_id in pack_ids if pack_id not in SYSTEM_SOURCE_PACK_BY_ID
    ]
    if unknown:
        raise ValueError(f"Unknown news source pack ids: {', '.join(unknown)}")
    return _dedupe(pack_ids)


def resolve_news_sources_for_workspace(
    *,
    selected_pack_ids: list[str] | tuple[str, ...] | None,
    disabled_source_ids: list[str] | tuple[str, ...] | None,
    symbol: str,
) -> list[NewsSource]:
    pack_ids = resolve_source_pack_ids_for_symbol(
        selected_pack_ids=selected_pack_ids,
        symbol=symbol,
    )
    disabled = {source_id.strip() for source_id in disabled_source_ids or []}
    base_symbol = _base_symbol(symbol)
    sources: list[NewsSource] = []
    seen: set[str] = set()

    for pack_id in pack_ids:
        pack = SYSTEM_SOURCE_PACK_BY_ID[pack_id]
        for source_id in pack.source_ids:
            if source_id in seen or source_id in disabled:
                continue
            system_source = SYSTEM_NEWS_SOURCE_BY_ID[source_id]
            if not _source_supports_symbol(
                system_source.supported_symbols, base_symbol
            ):
                continue
            seen.add(source_id)
            sources.append(system_source_to_news_source(system_source))
    return sources


def _source_supports_symbol(supported_symbols: list[str], symbol: str) -> bool:
    supported = {item.upper() for item in supported_symbols}
    return "ALL" in supported or symbol.upper() in supported


def _base_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().split("/")[0].split(":")[0] or "UNKNOWN"


def _dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out
