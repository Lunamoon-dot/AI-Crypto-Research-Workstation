"""Research run lifecycle model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class ResearchRunStatus(str, Enum):
    """Lifecycle state for a research run."""

    CREATED = "created"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ResearchRun(BaseModel):
    """A single research workflow from market snapshot to thesis."""

    id: str | None = None
    symbol: str
    asset_class: str = "crypto"
    timeframe: str | None = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None
    market_snapshot_id: str | None = None
    signal_snapshot_id: str | None = None
    signal_ids: list[str] = Field(default_factory=list)
    debate_id: str | None = None
    thesis_id: str | None = None
    user_decision_id: str | None = None
    outcome_review_id: str | None = None
    status: ResearchRunStatus = ResearchRunStatus.CREATED
