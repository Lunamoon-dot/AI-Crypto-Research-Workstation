"""AI-generated trade thesis model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ThesisDirection(str, Enum):
    """Direction of a thesis recommendation."""

    LONG = "long"
    SHORT = "short"
    WATCH = "watch"
    AVOID = "avoid"
    NEUTRAL = "neutral"


class TradeThesis(BaseModel):
    """AI-generated thesis for manual trader review."""

    id: str | None = None
    research_run_id: str | None = None
    symbol: str
    direction: ThesisDirection = ThesisDirection.WATCH
    setup_type: str = "unspecified"
    thesis_text: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    entry_zone: str | None = None
    invalidation_level: str | None = None
    target_zones: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)
    supporting_signal_ids: list[str] = Field(default_factory=list)
    contradicting_signal_ids: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
