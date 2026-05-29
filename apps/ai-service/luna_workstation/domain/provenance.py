"""Data provenance and freshness metadata."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class DataFreshness(str, Enum):
    """Freshness state for a market data point."""

    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"


class SignalProvenance(BaseModel):
    """Where a signal came from and how trustworthy the source data is."""

    source: str = Field(description="Human-readable data source or provider name.")
    source_timestamp: datetime | None = Field(
        default=None,
        description="Timestamp reported by the upstream source, if available.",
    )
    observed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="When this application observed the data.",
    )
    freshness: DataFreshness = Field(
        default=DataFreshness.UNKNOWN,
        description="Whether the data is fresh enough for the current workflow.",
    )
    freshness_seconds: int | None = Field(
        default=None,
        description="Age of the data in seconds when known.",
    )
    confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Provider/data-confidence score from 0 to 1.",
    )
    historical_reliability: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Observed historical reliability for this source/signal.",
    )
    sample_size: int | None = Field(
        default=None,
        ge=0,
        description="Number of historical observations behind reliability.",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Provider-specific provenance details.",
    )
