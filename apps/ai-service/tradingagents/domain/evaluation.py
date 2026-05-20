"""Historical thesis evaluation models."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from .outcome import OutcomeResult


class ThesisEvaluation(BaseModel):
    """Quality evaluation for a saved thesis over a forward market window."""

    id: str | None = None
    thesis_id: str
    symbol: str
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    evaluation_start: date
    evaluation_end: date
    window_days: int
    start_price: float | None = None
    end_price: float | None = None
    max_high: float | None = None
    min_low: float | None = None
    max_favorable_excursion: float | None = None
    max_adverse_excursion: float | None = None
    target_level: float | None = None
    invalidation_level: float | None = None
    target_hit: bool = False
    invalidated: bool = False
    time_to_target_days: int | None = None
    time_to_invalidation_days: int | None = None
    result: OutcomeResult = OutcomeResult.UNKNOWN
    data_source: str = "ccxt_ohlcv"
    notes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)


class EvaluationMetricsRow(BaseModel):
    """Aggregated quality metrics for one grouping key."""

    key: str
    sample_size: int
    hit_rate: float | None = None
    invalidation_rate: float | None = None
    mixed_rate: float | None = None
    expired_rate: float | None = None
    unknown_rate: float | None = None
    average_mfe: float | None = None
    average_mae: float | None = None


class EvaluationAnalytics(BaseModel):
    """Aggregated analytics across persisted thesis evaluations."""

    total_sample_size: int = 0
    overall: EvaluationMetricsRow = Field(
        default_factory=lambda: EvaluationMetricsRow(key="overall", sample_size=0)
    )
    by_symbol: list[EvaluationMetricsRow] = Field(default_factory=list)
    by_setup: list[EvaluationMetricsRow] = Field(default_factory=list)
    by_confidence_bucket: list[EvaluationMetricsRow] = Field(default_factory=list)
    by_signal: list[EvaluationMetricsRow] = Field(default_factory=list)
    by_agent: list[EvaluationMetricsRow] = Field(default_factory=list)
