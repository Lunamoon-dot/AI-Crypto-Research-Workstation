"""System-maintained news source catalog contracts."""

from __future__ import annotations

from typing import Literal, Sequence

from pydantic import BaseModel, Field, field_validator, model_validator


NewsSourcePlatform = Literal["rss", "atom", "html", "api"]
NewsSourceAdapter = Literal["rss_atom", "html_list", "json_api"]
NewsSourceCategory = Literal[
    "official_project",
    "exchange_announcements",
    "regulatory",
    "security",
    "macro",
    "crypto_media",
    "governance",
    "aggregator",
]
NewsSourceTrustTier = Literal["high", "medium", "low", "aggregator"]


class HtmlParserConfig(BaseModel):
    item_selector: str
    title_selector: str
    link_selector: str
    published_selector: str | None = None
    summary_selector: str | None = None

    @field_validator(
        "item_selector",
        "title_selector",
        "link_selector",
        "published_selector",
        "summary_selector",
    )
    @classmethod
    def _normalize_selector(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("selector must not be blank")
        return normalized


class SystemNewsSource(BaseModel):
    id: str
    name: str
    source_type: Literal["news"] = "news"
    platform: NewsSourcePlatform
    adapter_id: NewsSourceAdapter
    locator: str
    category: NewsSourceCategory
    trust_tier: NewsSourceTrustTier
    official: bool
    supported_symbols: list[str]
    freshness_hours: int = Field(gt=0)
    enabled_by_default: bool = False
    parser_config: HtmlParserConfig | None = None

    @field_validator("id", "name", "locator")
    @classmethod
    def _normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field must not be blank")
        return normalized

    @field_validator("supported_symbols", mode="before")
    @classmethod
    def _normalize_supported_symbols(cls, value) -> list[str]:
        values = [value] if isinstance(value, str) else list(value or [])
        normalized = [str(item).strip().upper() for item in values if str(item).strip()]
        if not normalized:
            raise ValueError("supported_symbols must not be empty")
        return normalized

    @model_validator(mode="after")
    def _validate_platform_adapter(self) -> "SystemNewsSource":
        if self.platform in {"rss", "atom"} and self.adapter_id != "rss_atom":
            raise ValueError("rss and atom sources require rss_atom adapter")
        if self.platform == "html" and self.adapter_id != "html_list":
            raise ValueError("html sources require html_list adapter")
        if self.platform == "api" and self.adapter_id != "json_api":
            raise ValueError("api sources require json_api adapter")
        if self.platform == "html" and self.parser_config is None:
            raise ValueError("html sources require parser_config")
        return self


class SourcePack(BaseModel):
    id: str
    name: str
    description: str
    category: str
    source_ids: list[str]
    recommended_for: list[str]
    enabled_by_default: bool = False

    @field_validator("id", "name", "description", "category")
    @classmethod
    def _normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field must not be blank")
        return normalized

    @field_validator("source_ids")
    @classmethod
    def _validate_source_ids(cls, value: list[str]) -> list[str]:
        normalized = [str(item).strip() for item in value if str(item).strip()]
        if not normalized:
            raise ValueError("source_ids must not be empty")
        return normalized

    @field_validator("recommended_for", mode="before")
    @classmethod
    def _normalize_recommended_for(cls, value) -> list[str]:
        values = [value] if isinstance(value, str) else list(value or [])
        normalized = [str(item).strip().upper() for item in values if str(item).strip()]
        if not normalized:
            raise ValueError("recommended_for must not be empty")
        return normalized


def validate_source_packs(
    sources: Sequence[SystemNewsSource],
    packs: Sequence[SourcePack],
) -> None:
    source_ids = {source.id for source in sources}
    for pack in packs:
        missing = [
            source_id for source_id in pack.source_ids if source_id not in source_ids
        ]
        if missing:
            raise ValueError(
                f"Source pack {pack.id} references unknown sources: "
                f"{', '.join(missing)}"
            )
