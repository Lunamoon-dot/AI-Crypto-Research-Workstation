"""Scenario planning model."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ScenarioProbabilityBand(str, Enum):
    """Coarse probability band, intentionally not over-precise."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    UNKNOWN = "unknown"


class Scenario(BaseModel):
    """Conditional market map attached to a thesis."""

    id: str | None = None
    thesis_id: str | None = None
    condition: str
    expected_market_behavior: str
    probability_band: ScenarioProbabilityBand = ScenarioProbabilityBand.UNKNOWN
    invalidation: str = ""
    risk_map: list[str] = Field(default_factory=list)
    suggested_user_action: str = "review"
