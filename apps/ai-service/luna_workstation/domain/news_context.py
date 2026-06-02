"""Source-grounded news context models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class NewsSource(BaseModel):
    id: str
    name: str
    type: str = "rss"
    url: str
    category: str
    trust_tier: str = "medium"
    target_analysts: list[str] = Field(default_factory=lambda: ["news"])
    scope: list[str] = Field(default_factory=lambda: ["ALL"])
    official: bool = False
    workspace_id: str | None = None
    parser_mode: str | None = None
    selectors: dict[str, str] = Field(default_factory=dict)

    @field_validator("target_analysts", mode="before")
    @classmethod
    def _normalize_target_analysts(cls, value) -> list[str]:
        if value is None:
            return ["news"]
        if isinstance(value, str):
            value = value.split(",")
        return [
            str(item).strip().lower()
            for item in value
            if str(item).strip().lower() in {"news", "social"}
        ] or ["news"]

    @field_validator("scope", mode="before")
    @classmethod
    def _normalize_scope(cls, value) -> list[str]:
        if value is None:
            return ["ALL"]
        if isinstance(value, str):
            value = [value]
        return [str(item).strip().upper() for item in value if str(item).strip()]

    @property
    def evidence_type(self) -> str:
        if self.workspace_id:
            return "user_configured_source"
        if self.category == "aggregator":
            return "aggregator"
        if self.official:
            return "official_source"
        if self.category in {
            "official_project",
            "exchange_announcements",
            "security",
            "regulatory",
            "macro",
        }:
            return "primary_source"
        return "reputable_media"


class AssetNewsProfile(BaseModel):
    symbol: str
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)
    disambiguation_terms: list[str] = Field(default_factory=list)
    official_domains: list[str] = Field(default_factory=list)
    symbol_only_match_allowed: bool = True

    @field_validator(
        "aliases",
        "disambiguation_terms",
        "official_domains",
        mode="before",
    )
    @classmethod
    def _normalize_text_list(cls, value) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        return [str(item).strip() for item in value if str(item).strip()]


class NewsItem(BaseModel):
    title: str
    url: str
    canonical_url: str
    source_id: str
    source_name: str
    source_category: str
    trust_tier: str
    published_at: str
    fetched_at: str
    summary: str | None = None
    author: str | None = None
    matched_assets: list[str] = Field(default_factory=list)
    catalyst_tags: list[str] = Field(default_factory=list)
    relevance_score: float = Field(default=0.0, ge=0.0, le=1.0)
    source_trust_score: float = Field(default=0.0, ge=0.0, le=1.0)
    freshness_score: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence_type: str = "reputable_media"
    supporting_urls: list[str] = Field(default_factory=list)

    @field_validator(
        "matched_assets", "catalyst_tags", "supporting_urls", mode="before"
    )
    @classmethod
    def _normalize_text_list(cls, value) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        return [str(item).strip() for item in value if str(item).strip()]


class NewsStoryCluster(BaseModel):
    tag: str
    lead_title: str
    lead_source: str
    article_count: int = 0
    supporting_urls: list[str] = Field(default_factory=list)


class NewsCoverage(BaseModel):
    default_sources: str = "skipped"
    workspace_sources: str = "skipped"
    targeted_search: str = "skipped"
    aggregator: str = "skipped"


class NewsMateriality(BaseModel):
    status: str = "unknown"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value) -> str:
        normalized = str(value or "unknown").strip().lower()
        if normalized not in {
            "material_news_found",
            "no_material_news_found",
            "unknown",
        }:
            return "unknown"
        return normalized


class NewsFetchResult(BaseModel):
    source_id: str
    status: str
    fetched_at: str | None = None
    http_status: int | None = None
    raw_bytes: int = 0
    error_code: str | None = None
    error_message: str | None = None


class NewsParseResult(BaseModel):
    source_id: str
    parser_mode: str
    raw_count: int = 0
    parsed_count: int = 0
    rejected_count: int = 0
    rejection_reasons: dict[str, int] = Field(default_factory=dict)


class NewsItemDecision(BaseModel):
    source_id: str
    item_url: str | None = None
    decision: str
    reason: str
    matched_alias: str | None = None
    relevance_score: float = 0.0


class NewsSourceHealth(BaseModel):
    source_id: str
    fetch_status: str
    parse_status: str
    raw_count: int = 0
    parsed_count: int = 0
    accepted_count: int = 0
    rejected_count: int = 0
    rejection_reasons: dict[str, int] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None

    def model_dump_compact(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "fetch_status": self.fetch_status,
            "parse_status": self.parse_status,
            "raw_count": self.raw_count,
            "parsed_count": self.parsed_count,
            "accepted_count": self.accepted_count,
            "rejected_count": self.rejected_count,
            "rejection_reasons": dict(self.rejection_reasons),
            "error_code": self.error_code,
            "error_message": self.error_message,
        }


class NewsQuality(BaseModel):
    status: str = "insufficient_data"
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    reason_codes: list[str] = Field(default_factory=list)

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value) -> str:
        normalized = str(value or "insufficient_data").strip().lower()
        if normalized in {"insufficient", "missing"}:
            return "insufficient_data"
        if normalized not in {"clean", "degraded", "insufficient_data"}:
            return "degraded"
        return normalized


class NewsContext(BaseModel):
    instrument: str
    window_start: str
    window_end: str
    coverage: NewsCoverage = Field(default_factory=NewsCoverage)
    quality: NewsQuality = Field(default_factory=NewsQuality)
    materiality: NewsMateriality = Field(default_factory=NewsMateriality)
    source_health: list[NewsSourceHealth] = Field(default_factory=list)
    item_decisions: list[NewsItemDecision] = Field(default_factory=list)
    items: list[NewsItem] = Field(default_factory=list)
    story_clusters: list[NewsStoryCluster] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)

    def to_prompt_block(self) -> str:
        lines = [
            "===== PRE-COMPUTED NEWS CONTEXT =====",
            f"Instrument: {self.instrument}",
            f"Window: {self.window_start} -> {self.window_end}",
            f"Quality: {self.quality.status} ({self.quality.score:.2f})",
            f"Materiality: {self.materiality.status}",
            "",
            "Coverage:",
            f"- default_sources: {self.coverage.default_sources}",
            f"- workspace_sources: {self.coverage.workspace_sources}",
            f"- targeted_search: {self.coverage.targeted_search}",
            f"- aggregator: {self.coverage.aggregator}",
        ]
        lines.extend(["", "Source health:"])
        if not self.source_health:
            lines.append("- none")
        for health in self.source_health:
            details = (
                f"{health.source_id}: {health.fetch_status}/{health.parse_status}, "
                f"raw {health.raw_count}, parsed {health.parsed_count}, "
                f"accepted {health.accepted_count}, rejected {health.rejected_count}"
            )
            if health.error_code:
                details += f", error {health.error_code}"
            lines.append(f"- {details}")

        lines.extend(["", "Top catalysts:"])
        if self.materiality.status == "no_material_news_found":
            lines.append("- No material news found for this instrument/window.")
        if not self.items and self.materiality.status != "no_material_news_found":
            lines.append("- none")
        for item in self.items[:8]:
            tag = _primary_tag(item)
            lines.append(
                "- "
                f"{item.title}, source {item.source_name}, "
                f"category {tag}, relevance {_relevance_label(item.relevance_score)}"
            )

        lines.extend(["", "Confirmed Primary-Source Items:"])
        primary_items = [
            item
            for item in self.items
            if item.evidence_type
            in {"primary_source", "official_source", "user_configured_source"}
        ]
        if not primary_items:
            lines.append("- none")
        for item in primary_items[:6]:
            lines.append(
                "- "
                f"Title: {item.title}; URL: {item.canonical_url}; "
                f"Published: {item.published_at}; Source: {item.source_name}"
            )

        lines.extend(["", "Media / Aggregator Context:"])
        secondary_items = [
            item
            for item in self.items
            if item.evidence_type in {"reputable_media", "aggregator", "search_result"}
        ]
        if not secondary_items:
            lines.append("- none")
        for item in secondary_items[:6]:
            lines.append(
                "- "
                f"Title: {item.title}; URL: {item.canonical_url}; "
                f"Published: {item.published_at}; Source: {item.source_name}"
            )

        lines.extend(["", "Story clusters:"])
        if not self.story_clusters:
            lines.append("- none")
        for cluster in self.story_clusters:
            lines.append(
                "- "
                f"{cluster.tag}: {cluster.article_count} articles, "
                f"lead source {cluster.lead_source}"
            )

        lines.extend(["", "Missing/degraded data:"])
        missing = [*self.missing_data, *self.quality.reason_codes]
        if not missing:
            lines.append("- none")
        else:
            for reason in _dedupe(missing):
                lines.append(f"- {reason}")

        lines.extend(
            [
                "",
                "Rules for analyst:",
                "- Treat official/default/user-configured sources as primary evidence when relevant.",
                "- Treat aggregator/search-only items as degraded supporting evidence.",
                "- Do not fabricate headlines, URLs, publication dates, or catalysts.",
                "===== END NEWS CONTEXT =====",
            ]
        )
        return "\n".join(lines)


def _primary_tag(item: NewsItem) -> str:
    if not item.catalyst_tags:
        return item.source_category
    if any(tag in {"listing", "delisting"} for tag in item.catalyst_tags):
        return "exchange_listing_or_margin"
    return item.catalyst_tags[0]


def _relevance_label(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def _dedupe(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out
