"""Timeline events for research runs and thesis lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .tenancy import normalize_workspace_id


class TimelineEvent(BaseModel):
    """A persisted journal event used to reconstruct run and thesis timelines."""

    id: str | None = None
    workspace_id: str = "local"
    research_run_id: str
    thesis_id: str | None = None
    event_type: str
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)
