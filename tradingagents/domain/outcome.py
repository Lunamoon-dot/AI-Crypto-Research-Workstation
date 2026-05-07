"""Outcome review models for thesis quality feedback."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class OutcomeResult(str, Enum):
    """Outcome category for a reviewed thesis."""

    HIT_TARGET = "hit_target"
    INVALIDATED = "invalidated"
    MIXED = "mixed"
    EXPIRED = "expired"
    UNKNOWN = "unknown"


class OutcomeReview(BaseModel):
    """Post-thesis review used to calibrate future research."""

    id: str | None = None
    thesis_id: str
    reviewed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    result: OutcomeResult = OutcomeResult.UNKNOWN
    max_favorable_excursion: float | None = None
    max_adverse_excursion: float | None = None
    invalidated: bool = False
    lessons: str = ""
