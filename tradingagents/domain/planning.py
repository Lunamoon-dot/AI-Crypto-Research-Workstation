"""Assisted trade-planning artifact.

This is intentionally not an order model. It describes a recommendation for
manual review and preserves an audit trail of why no autonomous execution
occurred.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class PlanningStatus(str, Enum):
    """Status for assisted planning output."""

    PLANNED = "planned"
    WATCH = "watch"
    BLOCKED = "blocked"
    ERROR = "error"


class TradePlanRecommendation(BaseModel):
    """AI-generated planning artifact for manual review."""

    status: PlanningStatus = PlanningStatus.PLANNED
    symbol: str
    side: str | None = None
    action: str | None = None
    rating: str = ""
    reason: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    alloc_pct: float | None = None
    last_price: float | None = None
    order_id: str | None = None
    filled: float = 0.0
    avg_price: float = 0.0
    sl: float | None = None
    tp: float | None = None
    sizing_reasoning: str = ""
    steps: list[dict] = Field(default_factory=list)

    def to_legacy_dict(self) -> dict:
        """Return the dict shape used by the current CLI panel."""
        if hasattr(self, "model_dump"):
            data = self.model_dump(mode="json")
        else:
            data = self.dict()
        data["status"] = self.status.value
        return data
