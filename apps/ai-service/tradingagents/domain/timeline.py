"""Timeline events for research runs and thesis lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class TimelineEvent(BaseModel):
    """A persisted journal event used to reconstruct run and thesis timelines."""

    id: str | None = None
    research_run_id: str
    thesis_id: str | None = None
    event_type: str
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
