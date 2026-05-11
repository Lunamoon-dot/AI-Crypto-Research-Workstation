"""Performance trending and health-check domain models."""

from __future__ import annotations

from datetime import date, datetime, timezone

from pydantic import BaseModel, Field


class TrendPoint(BaseModel):
    """One time-bucketed data point in a performance trend line."""

    week_start: date
    sample_size: int = 0
    hit_rate: float | None = None
    avg_mfe: float | None = None
    avg_mae: float | None = None
    calibration_quality: str = "insufficient_data"


class HealthReport(BaseModel):
    """Signal whether the prediction pipeline is healthy, degraded, or critical."""

    overall_status: str = Field(
        default="insufficient_data",
        description="healthy | degraded | critical | insufficient_data",
    )
    recent_sample_size: int = 0
    baseline_sample_size: int = 0
    recent_hit_rate: float | None = None
    baseline_hit_rate: float | None = None
    alerts: list[str] = Field(default_factory=list)
    recommendation: str = ""
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
