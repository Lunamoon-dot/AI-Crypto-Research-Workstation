"""Structured agent opinion models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class AgentStance(str, Enum):
    """Directional stance used by analyst and debate opinions."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    UNCERTAIN = "uncertain"


class AgentOpinion(BaseModel):
    """Typed opinion emitted or adapted from an agent's research output."""

    id: str | None = None
    research_run_id: str | None = None
    debate_id: str | None = None
    agent_name: str
    role: str = "analyst"
    stance: AgentStance = AgentStance.UNCERTAIN
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    data_quality: float = Field(default=1.0, ge=0.0, le=1.0)
    data_quality_label: str = "clean"
    key_evidence: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    invalidation_conditions: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    raw_text: str = ""
    source_report_type: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("data_quality_label", mode="before")
    @classmethod
    def _normalize_data_quality_label(cls, value: Any) -> str:
        normalized = str(value or "clean").strip().lower()
        if normalized in {"insufficient", "insufficient_data", "missing"}:
            return "insufficient_data"
        if normalized in {"degraded", "partial", "low_confidence"}:
            return "degraded"
        return "clean"

    @field_validator("missing_data", "reason_codes", mode="before")
    @classmethod
    def _normalize_text_list(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = list(value) if isinstance(value, tuple) else [value]
        return [str(item).strip()[:500] for item in value if str(item).strip()]

    @model_validator(mode="after")
    def _mirror_low_data_quality_label(self) -> "AgentOpinion":
        if self.data_quality < 0.35:
            self.data_quality_label = "insufficient_data"
        elif self.data_quality < 0.75 and self.data_quality_label == "clean":
            self.data_quality_label = "degraded"
        return self


def render_agent_opinion(opinion: AgentOpinion) -> str:
    """Render an AgentOpinion as stable markdown for downstream agents."""

    confidence = (
        f"{opinion.confidence:.0%}" if opinion.confidence is not None else "N/A"
    )
    lines = [
        f"**Agent**: {opinion.agent_name}",
        f"**Role**: {opinion.role}",
        f"**Stance**: {opinion.stance.value}",
        f"**Confidence**: {confidence}",
        f"**Data Quality**: {opinion.data_quality_label} ({opinion.data_quality:.0%})",
        "",
        "**Key Evidence**:",
    ]
    lines.extend(_render_list(opinion.key_evidence))
    lines.extend(["", "**Risks**:"])
    lines.extend(_render_list(opinion.risks))
    lines.extend(["", "**Invalidation Conditions**:"])
    lines.extend(_render_list(opinion.invalidation_conditions))
    lines.extend(["", "**Missing Data**:"])
    lines.extend(_render_list(opinion.missing_data))
    lines.extend(["", "**Reason Codes**:"])
    lines.extend(_render_list(opinion.reason_codes))
    if opinion.raw_text:
        lines.extend(["", "**Source Report**:", opinion.raw_text])
    return "\n".join(lines)


def _render_list(values: list[str]) -> list[str]:
    if not values:
        return ["- None identified."]
    return [f"- {value}" for value in values]
