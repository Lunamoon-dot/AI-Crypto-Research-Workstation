"""Outcome analytics and retrospective intelligence models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RetrospectiveInsight(BaseModel):
    """Deterministic lesson extracted from reviewed thesis outcomes."""

    insight_type: str
    message: str
    thesis_ids: list[str] = Field(default_factory=list)
    evidence_count: int = 0


class OutcomeAnalytics(BaseModel):
    """Aggregate quality metrics for reviewed trade theses."""

    sample_size: int = 0
    symbol: str | None = None
    result_counts: dict[str, int] = Field(default_factory=dict)
    hit_rate: float | None = None
    invalidation_rate: float | None = None
    mixed_rate: float | None = None
    average_mfe: float | None = None
    average_mae: float | None = None
    reviewed_thesis_ids: list[str] = Field(default_factory=list)
    recent_lessons: list[str] = Field(default_factory=list)
    insights: list[RetrospectiveInsight] = Field(default_factory=list)
