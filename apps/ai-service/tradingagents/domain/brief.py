"""Daily market brief models for the research workstation."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .tenancy import normalize_workspace_id


class BriefAssetSummary(BaseModel):
    """Point-in-time market context for one asset in a daily brief."""

    symbol: str
    current_price: float | None = None
    market_regime: str = "unknown"
    trend_direction: str = "unknown"
    volatility_regime: str = "unknown"
    source: str | None = None
    source_timestamp: datetime | None = None
    summary: str = ""
    change_from_previous: str | None = None


class BriefThesisUpdate(BaseModel):
    """Daily update for an active thesis referenced by a watchlist."""

    thesis_id: str
    symbol: str
    direction: str
    setup_type: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    status: str = "review"
    update: str
    invalidation_level: str | None = None
    recent_alerts: list[str] = Field(default_factory=list)


class MarketBrief(BaseModel):
    """Structured daily market brief built from persisted local journal data."""

    id: str | None = None
    workspace_id: str = "local"
    brief_date: date = Field(default_factory=lambda: datetime.now(timezone.utc).date())
    watchlist_name: str = "default"
    title: str = "Market Brief"
    regime_summary: str = ""
    asset_summaries: list[BriefAssetSummary] = Field(default_factory=list)
    thesis_updates: list[BriefThesisUpdate] = Field(default_factory=list)
    watchlist_changes: list[str] = Field(default_factory=list)
    top_setups: list[str] = Field(default_factory=list)
    top_risks: list[str] = Field(default_factory=list)
    memory_notes: list[str] = Field(default_factory=list)
    previous_brief_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)
