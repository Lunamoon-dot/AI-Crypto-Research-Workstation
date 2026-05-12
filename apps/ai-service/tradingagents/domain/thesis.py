"""AI-generated trade thesis model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .tenancy import normalize_workspace_id


class ThesisDirection(str, Enum):
    """Direction of a thesis recommendation."""

    LONG = "long"
    SHORT = "short"
    WATCH = "watch"
    AVOID = "avoid"
    NEUTRAL = "neutral"


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
    entry_zone: str = ""
    upside_catalyst: str = ""
    invalidation: str = ""
    target_zones: list[str] = Field(default_factory=list)
    key_reasons: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    spot_notes: str = ""
    perp_notes: str = ""
    missing_data: list[str] = Field(default_factory=list)
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
        "key_reasons",
        "risks",
        "missing_data",
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
    entry_zone: str | None = None
    invalidation_level: str | None = None
    target_zones: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)
    supporting_signal_ids: list[str] = Field(default_factory=list)
    contradicting_signal_ids: list[str] = Field(default_factory=list)
    agent_opinion_ids: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    consensus: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    why_this_thesis: str = ""
    supporting_evidence: list[str] = Field(default_factory=list)
    contradicting_evidence: list[str] = Field(default_factory=list)
    stale_or_missing_data: list[str] = Field(default_factory=list)
    invalidation: str = ""
    monitor_next: list[str] = Field(default_factory=list)
    confidence_rationale: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)
