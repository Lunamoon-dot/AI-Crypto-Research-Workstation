"""AI-generated trade thesis model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .tenancy import normalize_workspace_id


class ThesisDirection(str, Enum):
    """Direction of a thesis recommendation."""

    LONG = "long"
    SHORT = "short"
    WATCH = "watch"
    AVOID = "avoid"
    NEUTRAL = "neutral"


class ThesisArtifactStatus(str, Enum):
    """Trust status for a persisted thesis artifact."""

    VALID = "valid"
    DEGRADED = "degraded"
    BLOCKED = "blocked"
    LEGACY = "legacy"


class ThesisValidationSeverity(str, Enum):
    """Severity for deterministic thesis validation issues."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    BLOCKER = "blocker"


class ThesisTextSource(str, Enum):
    """Source of the user-facing thesis text."""

    COMPILED = "compiled"
    LEGACY = "legacy"
    DIAGNOSTIC = "diagnostic"
    MISSING = "missing"


class ThesisValidationIssue(BaseModel):
    """Machine-readable thesis contract validation issue."""

    code: str
    severity: ThesisValidationSeverity
    message: str
    field: str | None = None
    source: str | None = None

    @field_validator("code", "message", "field", "source", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text[:500] if text else None


class ThesisValidationResult(BaseModel):
    """Deterministic validation outcome for a thesis candidate."""

    status: ThesisArtifactStatus
    issues: list[ThesisValidationIssue] = Field(default_factory=list)
    degradation_reasons: list[str] = Field(default_factory=list)
    blocked_reasons: list[str] = Field(default_factory=list)
    confidence_cap: float | None = Field(default=None, ge=0.0, le=1.0)


class CompiledThesisSection(BaseModel):
    """Section rendered by the deterministic thesis compiler."""

    key: str
    title: str
    text: str
    source_fields: list[str] = Field(default_factory=list)


class CompiledThesis(BaseModel):
    """Deterministic user-facing thesis text and provenance."""

    text: str
    source: ThesisTextSource
    sections: list[CompiledThesisSection] = Field(default_factory=list)
    omitted_sections: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    compiler_version: str | None = None


ALLOWED_EVIDENCE_KINDS = {"observed", "reasoning", "missing"}
ALLOWED_SOURCE_ARTIFACTS = {
    "market_snapshot",
    "signal_snapshot",
    "trade_thesis",
    "agent_opinion",
    "research_debate",
    "research_run",
    "research_continuity",
    "external_report",
    "unknown",
}
ALLOWED_EVIDENCE_STRENGTHS = {"low", "medium", "high", "unknown"}
TEXT_LIKE_FIELDS = ("text", "summary", "reason", "description", "message")


class ResearchEvidenceItem(BaseModel):
    """Normalized evidence line attached to a thesis summary item."""

    text: str
    evidence_kind: str = "reasoning"
    source_artifact: str = "unknown"
    source_id: str | None = None
    source_field: str | None = None
    evidence_type: str | None = None
    strength: str | None = None

    @field_validator("text", mode="before")
    @classmethod
    def _normalize_text(cls, value: Any) -> str:
        return str(value or "").strip()[:500]

    @field_validator("evidence_kind", mode="before")
    @classmethod
    def _normalize_evidence_kind(cls, value: Any) -> str:
        normalized = str(value or "reasoning").strip().lower()
        return normalized if normalized in ALLOWED_EVIDENCE_KINDS else "reasoning"

    @field_validator("source_artifact", mode="before")
    @classmethod
    def _normalize_source_artifact(cls, value: Any) -> str:
        normalized = str(value or "unknown").strip().lower()
        return normalized if normalized in ALLOWED_SOURCE_ARTIFACTS else "unknown"

    @field_validator("source_id", "source_field", "evidence_type", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: Any) -> str | None:
        text = str(value).strip() if value is not None else ""
        return text[:500] if text else None

    @field_validator("strength", mode="before")
    @classmethod
    def _normalize_strength(cls, value: Any) -> str | None:
        if value is None or value == "":
            return None
        normalized = str(value).strip().lower()
        return normalized if normalized in ALLOWED_EVIDENCE_STRENGTHS else "unknown"


class StructuredResearchItem(BaseModel):
    """Object-first claim, risk, or watchpoint with item-level evidence."""

    model_config = ConfigDict(extra="allow")

    text: str
    supporting_evidence: list[ResearchEvidenceItem] = Field(default_factory=list)

    @field_validator("text", mode="before")
    @classmethod
    def _normalize_text(cls, value: Any) -> str:
        return str(value or "").strip()[:500]

    @field_validator("supporting_evidence", mode="before")
    @classmethod
    def _normalize_supporting_evidence(cls, value: Any) -> list[dict[str, Any]]:
        return normalize_evidence_items(value)


ResearchSummaryItem = str | StructuredResearchItem


class ThesisCandidate(BaseModel):
    """Structured candidate contract produced by Portfolio Manager V1."""

    model_config = ConfigDict(extra="allow")

    schema_version: str = "thesis_candidate.v1"
    rating: str = ""
    direction: str = ""
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    market_type: str = "spot"
    action_summary: str = ""
    investment_thesis: str = ""
    confirmation_condition: str = ""
    invalidation: str = ""
    entry_zone: str | None = None
    target_zones: list[str] = Field(default_factory=list)
    profit_targets: list[str] = Field(default_factory=list)
    downside_objectives: list[str] = Field(default_factory=list)
    accumulation_zones: list[str] = Field(default_factory=list)
    indicator_thresholds: list[str] = Field(default_factory=list)
    key_reasons: list[ResearchSummaryItem] = Field(default_factory=list)
    risks: list[ResearchSummaryItem] = Field(default_factory=list)
    monitor_next: list[ResearchSummaryItem] = Field(default_factory=list)
    supporting_evidence: list[ResearchEvidenceItem] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    spot_notes: str = ""
    perp_notes: str = ""
    scenario_continuity_handoff: dict[str, Any] | None = None

    @field_validator(
        "schema_version",
        "rating",
        "direction",
        "market_type",
        "action_summary",
        "investment_thesis",
        "confirmation_condition",
        "invalidation",
        "entry_zone",
        "spot_notes",
        "perp_notes",
        mode="before",
    )
    @classmethod
    def _normalize_text(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()[:1000]

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, value: Any) -> float | None:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            raw = value.strip()
            is_percent = raw.endswith("%")
            raw = raw.rstrip("%").strip()
            try:
                number = float(raw)
            except ValueError:
                return None
            if is_percent or number > 1:
                number = number / 100
            return max(min(number, 1.0), 0.0)
        return value

    @field_validator(
        "target_zones",
        "profit_targets",
        "downside_objectives",
        "accumulation_zones",
        "indicator_thresholds",
        "missing_data",
        mode="before",
    )
    @classmethod
    def _normalize_text_list(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = list(value) if isinstance(value, tuple) else [value]
        return [str(item).strip()[:500] for item in value if str(item).strip()]

    @field_validator("key_reasons", "risks", "monitor_next", mode="before")
    @classmethod
    def _normalize_research_item_list(cls, value: Any) -> list[Any]:
        return _normalize_research_items(value)

    @field_validator("supporting_evidence", mode="before")
    @classmethod
    def _normalize_supporting_evidence(cls, value: Any) -> list[dict[str, Any]]:
        return normalize_evidence_items(value)


def text_from_research_item(value: Any) -> str:
    """Extract display text from a legacy string or object-first summary item."""

    if isinstance(value, StructuredResearchItem):
        return value.text
    if isinstance(value, dict):
        return _first_text_like(value)
    if value is None:
        return ""
    return str(value).strip()


def research_item_texts(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    return [text for item in values if (text := text_from_research_item(item).strip())]


def normalize_evidence_items(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    normalized: list[dict[str, Any]] = []
    for item in values:
        evidence = _normalize_evidence_item(item)
        if evidence is not None:
            normalized.append(evidence)
    return normalized


def _normalize_evidence_item(value: Any) -> dict[str, Any] | None:
    if isinstance(value, ResearchEvidenceItem):
        return value.model_dump(mode="python")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return {
            "text": text[:500],
            "evidence_kind": "reasoning",
            "source_artifact": "trade_thesis",
        }
    if not isinstance(value, dict):
        text = str(value).strip()
        return (
            {
                "text": text[:500],
                "evidence_kind": "reasoning",
                "source_artifact": "trade_thesis",
            }
            if text
            else None
        )

    text = _first_text_like(value)
    if not text:
        return None
    result = dict(value)
    result["text"] = text[:500]
    result["evidence_kind"] = _allowed_string(
        result.get("evidence_kind"),
        ALLOWED_EVIDENCE_KINDS,
        "reasoning",
    )
    result["source_artifact"] = _allowed_string(
        result.get("source_artifact"),
        ALLOWED_SOURCE_ARTIFACTS,
        "unknown",
    )
    if "strength" in result:
        result["strength"] = _allowed_string(
            result.get("strength"),
            ALLOWED_EVIDENCE_STRENGTHS,
            "unknown",
        )
    return result


def _normalize_research_items(value: Any) -> list[ResearchSummaryItem | dict[str, Any]]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    normalized: list[ResearchSummaryItem | dict[str, Any]] = []
    for item in values:
        if isinstance(item, StructuredResearchItem):
            normalized.append(item)
            continue
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append(text[:500])
            continue
        if isinstance(item, dict):
            text = _first_text_like(item)
            if not text:
                continue
            next_item = dict(item)
            next_item["text"] = text[:500]
            next_item["supporting_evidence"] = normalize_evidence_items(
                next_item.get("supporting_evidence")
            )
            normalized.append(next_item)
            continue
        text = str(item).strip()
        if text:
            normalized.append(text[:500])
    return normalized


def _first_text_like(value: dict[str, Any]) -> str:
    for field in TEXT_LIKE_FIELDS:
        candidate = value.get(field)
        if candidate is not None and str(candidate).strip():
            return str(candidate).strip()
    return ""


def _allowed_string(value: Any, allowed: set[str], fallback: str) -> str:
    normalized = str(value or fallback).strip().lower()
    return normalized if normalized in allowed else fallback


def _machine_key(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def _thesis_direction_value(value: ThesisDirection | str) -> str:
    return value.value if isinstance(value, ThesisDirection) else _machine_key(value)


def _risk_off_thesis(rating: str, direction: ThesisDirection | str) -> bool:
    normalized_rating = _machine_key(rating)
    normalized_direction = _thesis_direction_value(direction)
    return (
        normalized_rating in {"underweight", "sell"}
        or normalized_direction in {"avoid", "short"}
        or "bear" in normalized_direction
    )


def _risk_on_thesis(rating: str, direction: ThesisDirection | str) -> bool:
    normalized_rating = _machine_key(rating)
    normalized_direction = _thesis_direction_value(direction)
    return (
        normalized_rating in {"overweight", "buy"}
        or normalized_direction == "long"
        or "bull" in normalized_direction
    )


def _default_recommended_action(
    rating: str,
    direction: ThesisDirection | str,
) -> str:
    if _risk_off_thesis(rating, direction):
        return "avoid_long"
    if _risk_on_thesis(rating, direction):
        return "consider_long"
    return "watch_only"


def _default_market_bias(rating: str, direction: ThesisDirection | str) -> str:
    if _risk_off_thesis(rating, direction):
        return "defensive"
    if _risk_on_thesis(rating, direction):
        return "bullish"
    return "neutral"


def _default_entry_plan_status(recommended_action: str, entry_zone: str) -> str:
    if recommended_action == "avoid_long":
        return "no_trade"
    if entry_zone.strip():
        return "conditional"
    if recommended_action == "watch_only":
        return "no_trade"
    return "conditional"


class TradeThesisStructuredSummary(BaseModel):
    """Short validated contract intended for UI clients."""

    rating: str = Field(
        default="Hold",
        description="One of Buy, Overweight, Hold, Underweight, or Sell.",
    )
    direction: ThesisDirection = ThesisDirection.WATCH
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    market_type: str = "spot"
    action_summary: str = ""
    recommended_action: str = ""
    market_bias: str = ""
    entry_plan_status: str = ""
    confirmation_condition: str = ""
    entry_zone: str = ""
    upside_catalyst: str = ""
    invalidation: str = ""
    target_zones: list[str] = Field(default_factory=list)
    profit_targets: list[str] = Field(default_factory=list)
    downside_objectives: list[str] = Field(default_factory=list)
    accumulation_zones: list[str] = Field(default_factory=list)
    indicator_thresholds: list[str] = Field(default_factory=list)
    key_reasons: list[ResearchSummaryItem] = Field(default_factory=list)
    risks: list[ResearchSummaryItem] = Field(default_factory=list)
    monitor_next: list[ResearchSummaryItem] = Field(default_factory=list)
    supporting_evidence: list[ResearchEvidenceItem] = Field(default_factory=list)
    spot_notes: str = ""
    perp_notes: str = ""
    missing_data: list[str] = Field(default_factory=list)
    missing_data_reason_codes: list[str] = Field(default_factory=list)
    data_quality: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Machine-readable data confidence independent from market stance.",
    )
    data_quality_label: str = Field(
        default="clean",
        description="clean | degraded | insufficient_data",
    )
    is_degraded: bool = False
    degradation_reasons: list[str] = Field(default_factory=list)

    @field_validator("rating", mode="before")
    @classmethod
    def _normalize_rating(cls, value: Any) -> str:
        ratings = {
            "buy": "Buy",
            "overweight": "Overweight",
            "hold": "Hold",
            "underweight": "Underweight",
            "sell": "Sell",
        }
        if value is None:
            return "Hold"
        normalized = ratings.get(str(value).strip().lower())
        return normalized or "Hold"

    @field_validator("direction", mode="before")
    @classmethod
    def _normalize_direction(cls, value: Any) -> ThesisDirection:
        if isinstance(value, ThesisDirection):
            return value
        aliases = {
            "long": ThesisDirection.LONG,
            "buy": ThesisDirection.LONG,
            "bullish": ThesisDirection.LONG,
            "short": ThesisDirection.SHORT,
            "sell": ThesisDirection.SHORT,
            "bearish": ThesisDirection.SHORT,
            "watch": ThesisDirection.WATCH,
            "hold": ThesisDirection.WATCH,
            "avoid": ThesisDirection.AVOID,
            "neutral": ThesisDirection.NEUTRAL,
        }
        return aliases.get(str(value or "").strip().lower(), ThesisDirection.WATCH)

    @field_validator("recommended_action", mode="before")
    @classmethod
    def _normalize_recommended_action(cls, value: Any) -> str:
        aliases = {
            "avoid": "avoid_long",
            "avoid_long": "avoid_long",
            "no_long": "avoid_long",
            "stand_aside": "avoid_long",
            "no_trade": "avoid_long",
            "watch": "watch_only",
            "watch_only": "watch_only",
            "monitor": "watch_only",
            "wait": "watch_only",
            "reduce": "reduce_exposure",
            "reduce_exposure": "reduce_exposure",
            "trim": "reduce_exposure",
            "trim_exposure": "reduce_exposure",
            "consider_long": "consider_long",
            "enter_long": "consider_long",
            "long": "consider_long",
            "buy": "consider_long",
            "consider_short": "consider_short",
            "enter_short": "consider_short",
            "short": "consider_short",
            "sell": "consider_short",
        }
        return aliases.get(_machine_key(value), "")

    @field_validator("market_bias", mode="before")
    @classmethod
    def _normalize_market_bias(cls, value: Any) -> str:
        aliases = {
            "defensive": "defensive",
            "risk_off": "defensive",
            "cautious": "defensive",
            "avoid": "defensive",
            "bullish": "bullish",
            "bull": "bullish",
            "long": "bullish",
            "risk_on": "bullish",
            "bearish": "bearish",
            "bear": "bearish",
            "short": "bearish",
            "neutral": "neutral",
            "watch": "neutral",
            "mixed": "neutral",
        }
        return aliases.get(_machine_key(value), "")

    @field_validator("entry_plan_status", mode="before")
    @classmethod
    def _normalize_entry_plan_status(cls, value: Any) -> str:
        aliases = {
            "no_trade": "no_trade",
            "no_entry": "no_trade",
            "none": "no_trade",
            "avoid": "no_trade",
            "stand_aside": "no_trade",
            "ready": "ready",
            "actionable": "ready",
            "active": "ready",
            "conditional": "conditional",
            "wait_for_confirmation": "conditional",
            "watch": "conditional",
        }
        return aliases.get(_machine_key(value), "")

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, value: Any) -> float | None:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            raw = value.strip()
            is_percent = raw.endswith("%")
            raw = raw.rstrip("%").strip()
            try:
                number = float(raw)
            except ValueError:
                return None
            if is_percent or number > 1:
                number = number / 100
            return number
        return value

    @field_validator("market_type", mode="before")
    @classmethod
    def _normalize_market_type(cls, value: Any) -> str:
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return "perp"
        return "spot"

    @field_validator(
        "action_summary",
        "confirmation_condition",
        "entry_zone",
        "upside_catalyst",
        "invalidation",
        "spot_notes",
        "perp_notes",
        mode="before",
    )
    @classmethod
    def _normalize_text(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()[:500]

    @field_validator(
        "target_zones",
        "profit_targets",
        "downside_objectives",
        "accumulation_zones",
        "indicator_thresholds",
        "missing_data",
        "missing_data_reason_codes",
        "degradation_reasons",
        mode="before",
    )
    @classmethod
    def _normalize_text_list(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = list(value) if isinstance(value, tuple) else [value]
        return [str(item).strip()[:500] for item in value if str(item).strip()]

    @field_validator("key_reasons", "risks", "monitor_next", mode="before")
    @classmethod
    def _normalize_research_item_list(
        cls,
        value: Any,
    ) -> list[ResearchSummaryItem | dict[str, Any]]:
        return _normalize_research_items(value)

    @field_validator("supporting_evidence", mode="before")
    @classmethod
    def _normalize_supporting_evidence(cls, value: Any) -> list[dict[str, Any]]:
        return normalize_evidence_items(value)

    @field_validator("data_quality_label", mode="before")
    @classmethod
    def _normalize_data_quality_label(cls, value: Any) -> str:
        normalized = str(value or "clean").strip().lower()
        if normalized in {"insufficient", "insufficient_data", "missing"}:
            return "insufficient_data"
        if normalized in {"degraded", "partial", "low_confidence"}:
            return "degraded"
        return "clean"

    @model_validator(mode="after")
    def _derive_decision_semantics(self) -> "TradeThesisStructuredSummary":
        if not self.recommended_action:
            self.recommended_action = _default_recommended_action(
                self.rating,
                self.direction,
            )
        if not self.market_bias:
            self.market_bias = _default_market_bias(self.rating, self.direction)
        if not self.entry_plan_status:
            self.entry_plan_status = _default_entry_plan_status(
                self.recommended_action,
                self.entry_zone,
            )
        return self

    @model_validator(mode="after")
    def _mirror_data_quality_to_degraded(self) -> "TradeThesisStructuredSummary":
        if self.data_quality < 0.65 or self.data_quality_label != "clean":
            self.is_degraded = True
        return self


class TradeThesis(BaseModel):
    """AI-generated thesis for manual trader review."""

    id: str | None = None
    workspace_id: str = "local"
    research_run_id: str | None = None
    debate_id: str | None = None
    symbol: str
    direction: ThesisDirection = ThesisDirection.WATCH
    setup_type: str = "unspecified"
    structured_summary: TradeThesisStructuredSummary | None = None
    thesis_text: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    heuristic_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    empirical_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    empirical_confidence_sample_size: int = 0
    empirical_confidence_oos_sample_size: int = 0
    confidence_version: str = "heuristic:v1"
    entry_zone: str | None = None
    invalidation_level: str | None = None
    target_zones: list[str] = Field(default_factory=list)
    profit_targets: list[str] = Field(default_factory=list)
    downside_objectives: list[str] = Field(default_factory=list)
    accumulation_zones: list[str] = Field(default_factory=list)
    indicator_thresholds: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)
    supporting_signal_ids: list[str] = Field(default_factory=list)
    contradicting_signal_ids: list[str] = Field(default_factory=list)
    agent_opinion_ids: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    consensus: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    why_this_thesis: str = ""
    confirmation_condition: str = ""
    supporting_evidence: list[str] = Field(default_factory=list)
    contradicting_evidence: list[str] = Field(default_factory=list)
    stale_or_missing_data: list[str] = Field(default_factory=list)
    invalidation: str = ""
    monitor_next: list[str] = Field(default_factory=list)
    confidence_rationale: str = ""
    artifact_status: ThesisArtifactStatus = ThesisArtifactStatus.LEGACY
    thesis_text_source: ThesisTextSource = ThesisTextSource.LEGACY
    compiled_sections: list[CompiledThesisSection] = Field(default_factory=list)
    compiler_version: str | None = None
    raw_model_thesis_text: str | None = None
    validation_issues: list[ThesisValidationIssue] = Field(default_factory=list)
    degradation_reasons: list[str] = Field(default_factory=list)
    blocked_reasons: list[str] = Field(default_factory=list)
    candidate_schema_version: str | None = None
    prompt_version: str | None = None
    model_provider: str | None = None
    model_name: str | None = None
    source_contract: str | None = None
    thesis_candidate: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)

    @model_validator(mode="after")
    def _mirror_legacy_confidence(self) -> "TradeThesis":
        if self.heuristic_confidence is None and self.confidence is not None:
            self.heuristic_confidence = self.confidence
        if self.confidence is None and self.heuristic_confidence is not None:
            self.confidence = self.heuristic_confidence
        return self
