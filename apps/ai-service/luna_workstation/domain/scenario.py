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
    scenario_name: str = ""
    direction: str = ""
    thesis_impact: str = ""
    condition: str
    expected_market_behavior: str
    probability_band: ScenarioProbabilityBand = ScenarioProbabilityBand.UNKNOWN
    invalidation: str = ""
    evidence: list[str] = Field(default_factory=list)
    watch_triggers: list[str] = Field(default_factory=list)
    impact_on_thesis: str = ""
    risk_map: list[str] = Field(default_factory=list)
    suggested_user_action: str = "review"
    as_of: str = ""
    timeframe: str = ""
    source: list[str] = Field(default_factory=list)
    # Phase 5: template enforcement metadata
    template_metadata: dict = Field(
        default_factory=dict,
        description="Template enforcement metadata: setup_type, requested_setup_type, "
        "template_degraded, missing_fields, available_fields.",
    )
