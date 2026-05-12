"""Research debate persistence models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field

from .agent_opinion import AgentStance


class ConflictLevel(str, Enum):
    """Coarse conflict level across agent opinions."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ResearchDebate(BaseModel):
    """Structured summary of a multi-agent research debate."""

    id: str | None = None
    research_run_id: str | None = None
    symbol: str
    consensus_stance: AgentStance = AgentStance.UNCERTAIN
    consensus_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    conflict_level: ConflictLevel = ConflictLevel.LOW
    stance_counts: dict[str, int] = Field(default_factory=dict)
    opinion_ids: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
