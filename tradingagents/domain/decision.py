"""User decision models for the decision journal."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class UserDecisionAction(str, Enum):
    """How a user responded to a thesis."""

    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WATCHED = "watched"
    IGNORED = "ignored"
    NEEDS_MORE_RESEARCH = "needs_more_research"


class UserDecision(BaseModel):
    """Manual user decision attached to a thesis."""

    id: str | None = None
    thesis_id: str
    action: UserDecisionAction
    user_notes: str = ""
    decided_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
