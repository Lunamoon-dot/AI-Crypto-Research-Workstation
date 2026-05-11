"""JSON schemas for the worker-facing engine boundary."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, field_validator


class EngineRunRequest(BaseModel):
    """Stable JSON request accepted by ``tradingagents engine run``."""

    run_id: str | None = None
    workspace_id: str
    symbol: str
    asset_class: str = "crypto"
    analysis_date: date
    analysts: list[str] = Field(default_factory=lambda: ["market", "news"])
    config_profile: str | None = "default"
    exchange: str | None = None
    dry_run: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("symbol", "workspace_id")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("must not be blank")
        return clean

    @field_validator("analysts")
    @classmethod
    def _analysts_not_empty(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if not cleaned:
            raise ValueError("at least one analyst is required")
        return cleaned


class EngineRunResult(BaseModel):
    """Stable JSON result returned by the Python research engine."""

    run_id: str
    workspace_id: str
    status: str
    thesis_id: str | None = None
    summary: str = ""
    events_written: int = 0
    error_type: str | None = None
    error: str | None = None
