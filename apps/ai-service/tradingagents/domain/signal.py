"""Evidence-backed market signal model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .provenance import SignalProvenance
from .tenancy import normalize_workspace_id


class SignalDirection(str, Enum):
    """Directional interpretation of a signal."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class SignalEvidenceLane(str, Enum):
    """Market lane that produced the evidence."""

    SPOT = "spot"
    PERP = "perp"
    QUANT_BIAS = "quant_bias"
    UNKNOWN = "unknown"


class SignalWatchConditions(BaseModel):
    """Monitoring prompts derived from a signal, not execution instructions."""

    what_changed: str = ""
    invalidation: str = ""
    review_trigger: str = ""


class Signal(BaseModel):
    """A structured signal with evidence and provenance."""

    id: str | None = None
    workspace_id: str = "local"
    symbol: str
    signal_type: str = Field(description="Stable signal identifier.")
    direction: SignalDirection = SignalDirection.UNKNOWN
    evidence_lane: SignalEvidenceLane = SignalEvidenceLane.UNKNOWN
    evidence_category: str = "unknown"
    strength: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime | None = None
    provenance: SignalProvenance
    evidence: dict[str, Any] = Field(default_factory=dict)
    watch_conditions: SignalWatchConditions = Field(
        default_factory=SignalWatchConditions
    )
    summary: str = ""
    supporting: bool = Field(
        default=True,
        description="True when this supports the current thesis; false when it contradicts it.",
    )

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)
