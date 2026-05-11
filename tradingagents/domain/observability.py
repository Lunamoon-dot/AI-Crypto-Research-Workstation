"""Persisted observability records for product/backend consumers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class ProviderHealthRecord(BaseModel):
    """One provider call or health probe outcome."""

    id: str | None = None
    provider: str
    component: str | None = None
    status: str
    checked_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    latency_ms: float | None = None
    error_type: str | None = None
    error_message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class LLMCallRecord(BaseModel):
    """Normalized LLM call metrics for cost, latency, and failure analysis."""

    id: str | None = None
    research_run_id: str | None = None
    thesis_id: str | None = None
    provider: str
    model: str
    stage: str | None = None
    agent: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float | None = None
    status: str
    error_type: str | None = None
    error_message: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)


class DataFreshnessCheck(BaseModel):
    """Normalized freshness evidence for provider and signal data."""

    id: str | None = None
    research_run_id: str | None = None
    symbol: str | None = None
    source: str
    source_timestamp: datetime | None = None
    observed_timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    age_seconds: int | None = None
    threshold_seconds: int | None = None
    status: str
    payload: dict[str, Any] = Field(default_factory=dict)
