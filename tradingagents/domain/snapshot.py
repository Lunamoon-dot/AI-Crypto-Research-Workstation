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
