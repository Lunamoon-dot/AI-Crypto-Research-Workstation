"""Structured agent opinion models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class AgentStance(str, Enum):
    """Directional stance used by analyst and debate opinions."""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    UNCERTAIN = "uncertain"


class AgentOpinion(BaseModel):
    """Typed opinion emitted or adapted from an agent's research output."""

    id: str | None = None
    research_run_id: str | None = None
    debate_id: str | None = None
    agent_name: str
    role: str = "analyst"
    stance: AgentStance = AgentStance.UNCERTAIN
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    key_evidence: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    invalidation_conditions: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)
    raw_text: str = ""
    source_report_type: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
