"""Snapshot models for research-run evidence capture."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class MarketSnapshot(BaseModel):
    """Point-in-time market context attached to a research run."""

    id: str | None = None
    research_run_id: str | None = None
    symbol: str
    captured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    current_price: float | None = None
    trend_direction: str = "unknown"
    trend_strength: float | None = None
    volatility_regime: str = "unknown"
    market_regime: str = "unknown"
    source: str = "signal_engine"
    source_timestamp: datetime | None = None
    summary: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class SignalSnapshot(BaseModel):
    """Immutable list of saved signal IDs for a research run."""

    id: str | None = None
    research_run_id: str
    symbol: str
    captured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    signal_ids: list[str] = Field(default_factory=list)
    composite_signal_id: str | None = None
    bullish_count: int = 0
    bearish_count: int = 0
    neutral_count: int = 0
    stale_count: int = 0
    unknown_freshness_count: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Phase 4 (tail): Reliability snapshot — rolling-window factor performance
# ---------------------------------------------------------------------------


class FactorReliabilityEntry(BaseModel):
    """Per-factor reliability at a point in time."""

    factor_name: str
    hit_rate: float | None = None
    directional_accuracy: float | None = None
    sample_size: int = 0


class ReliabilitySnapshot(BaseModel):
    """Rolling-window snapshot of signal factor reliability.

    Captured at regular intervals (or on-demand after evaluation batches)
    so reliability trends can be surfaced in signals list/show and the
    journal workspace.
    """

    id: str | None = None
    symbol: str
    snapshot_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    rolling_window_days: int = Field(
        default=30,
        ge=1,
        le=365,
        description="Rolling window size in days (30 or 90).",
    )
    overall_hit_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Overall hit rate across all factors in this window.",
    )
    overall_sample_size: int = 0
    factors: list[FactorReliabilityEntry] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
