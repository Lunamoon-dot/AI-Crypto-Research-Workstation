"""Trade-thesis monitoring domain models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from .tenancy import normalize_workspace_id


class ThesisMonitorPlanStatus(str, Enum):
    """Lifecycle status for the machine-readable monitoring contract."""

    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    INVALID = "invalid"


class InvalidationDirection(str, Enum):
    """Direction that invalidates the thesis."""

    BELOW = "below"
    ABOVE = "above"


class ThesisPulseStatus(str, Enum):
    """Deterministic pulse severity."""

    CALM = "calm"
    WATCH = "watch"
    REVIEW = "review"
    RERUN_FULL = "rerun_full"


class ThesisPulseSuggestedAction(str, Enum):
    """Recommended user action from a pulse."""

    NONE = "none"
    INSPECT_CHART = "inspect_chart"
    RECORD_REVIEW = "record_review"
    RUN_MEMO = "run_memo"
    RERUN_FULL_RESEARCH = "rerun_full_research"


class ThesisTargetLevel(BaseModel):
    """A normalized target level from a thesis target zone."""

    label: str = ""
    price: float


class ThesisMonitorPlan(BaseModel):
    """Machine-readable contract used by cheap thesis pulses."""

    id: str | None = None
    workspace_id: str = "local"
    thesis_id: str
    baseline_run_id: str | None = None
    symbol: str
    market_type: str = "spot"
    status: ThesisMonitorPlanStatus = ThesisMonitorPlanStatus.DRAFT
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    baseline_price: float | None = None
    baseline_price_source: str = ""
    baseline_observed_at: datetime | None = None

    entry_low: float | None = None
    entry_high: float | None = None
    invalidation_level: float | None = None
    invalidation_direction: InvalidationDirection | None = None
    targets: list[ThesisTargetLevel] = Field(default_factory=list)
    scenario_triggers: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)

    price_interval_minutes: int = Field(default=5, ge=1, le=60)
    signal_interval_minutes: int = Field(default=15, ge=5, le=240)
    memo_interval_minutes: int = Field(default=240, ge=30, le=1440)
    watch_distance_pct: float = Field(default=5.0, ge=1.0, le=20.0)
    review_distance_pct: float = Field(default=2.0, ge=0.25, le=10.0)
    consecutive_review_to_rerun: int = Field(default=3, ge=1, le=10)
    consecutive_invalidation_to_rerun: int = Field(default=2, ge=1, le=10)
    run_memo_on_review: bool = True
    run_memo_on_rerun_full: bool = True
    skip_memo_if_no_new_pulses: bool = True
    enabled_signal_factors: list[str] = Field(
        default_factory=lambda: ["regime", "macd", "rsi_divergence", "volume"]
    )
    scheduler_enabled: bool = False

    latest_pulse_id: str | None = None
    latest_memo_id: str | None = None
    latest_status: ThesisPulseStatus | None = None
    latest_price: float | None = None
    latest_trigger_reasons: list[str] = Field(default_factory=list)
    last_pulse_at: datetime | None = None
    next_pulse_due_at: datetime | None = None
    last_memo_at: datetime | None = None
    next_memo_due_at: datetime | None = None

    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)

    @field_validator("market_type", mode="before")
    @classmethod
    def _normalize_market_type(cls, value: str | None) -> str:
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return "perp"
        return "spot"

    @model_validator(mode="after")
    def _dedupe_missing_fields(self) -> "ThesisMonitorPlan":
        self.missing_fields = _dedupe(self.missing_fields)
        return self


class ThesisPulse(BaseModel):
    """Immutable deterministic monitoring row for charting and status review."""

    id: str | None = None
    workspace_id: str = "local"
    thesis_id: str
    monitor_plan_id: str
    baseline_run_id: str | None = None
    symbol: str
    market_type: str = "spot"
    pulse_type: str = "manual"
    bucket_start: datetime
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    current_price: float | None = None
    baseline_price: float | None = None
    price_change_pct: float | None = None
    distance_to_entry_pct: float | None = None
    distance_to_invalidation_pct: float | None = None
    nearest_target: float | None = None
    distance_to_nearest_target_pct: float | None = None

    signal_bias: str = "unknown"
    signal_confidence: float | None = None
    signal_delta: float | None = None
    scenario_status: str = "none"

    score: int = Field(default=0, ge=0, le=100)
    status: ThesisPulseStatus = ThesisPulseStatus.CALM
    suggested_action: ThesisPulseSuggestedAction = ThesisPulseSuggestedAction.NONE
    trigger_reasons: list[str] = Field(default_factory=list)
    hard_triggers: list[str] = Field(default_factory=list)
    missing_data: list[str] = Field(default_factory=list)

    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)

    @field_validator("market_type", mode="before")
    @classmethod
    def _normalize_market_type(cls, value: str | None) -> str:
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return "perp"
        return "spot"

    @model_validator(mode="after")
    def _dedupe_lists(self) -> "ThesisPulse":
        self.trigger_reasons = _dedupe(self.trigger_reasons)
        self.hard_triggers = _dedupe(self.hard_triggers)
        self.missing_data = _dedupe(self.missing_data)
        return self


class ThesisPulseMemoDraft(BaseModel):
    """Structured LLM memo payload before persistence metadata is attached."""

    status: ThesisPulseStatus = ThesisPulseStatus.CALM
    summary: str = ""
    what_changed: list[str] = Field(default_factory=list)
    why_it_matters: list[str] = Field(default_factory=list)
    what_to_watch_next: list[str] = Field(default_factory=list)
    recommended_action: ThesisPulseSuggestedAction = ThesisPulseSuggestedAction.NONE
    rerun_full_recommended: bool = False
    referenced_pulse_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _clean_lists(self) -> "ThesisPulseMemoDraft":
        self.what_changed = _dedupe(self.what_changed)
        self.why_it_matters = _dedupe(self.why_it_matters)
        self.what_to_watch_next = _dedupe(self.what_to_watch_next)
        self.referenced_pulse_ids = _dedupe(self.referenced_pulse_ids)
        return self


class ThesisPulseMemo(BaseModel):
    """Persisted structured memo over a selected thesis pulse window."""

    id: str | None = None
    workspace_id: str = "local"
    thesis_id: str
    monitor_plan_id: str
    baseline_run_id: str | None = None
    memo_type: str = "manual"
    window_start: datetime
    window_end: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    status: ThesisPulseStatus = ThesisPulseStatus.CALM
    summary: str = ""
    what_changed: list[str] = Field(default_factory=list)
    why_it_matters: list[str] = Field(default_factory=list)
    what_to_watch_next: list[str] = Field(default_factory=list)
    recommended_action: ThesisPulseSuggestedAction = ThesisPulseSuggestedAction.NONE
    rerun_full_recommended: bool = False
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    referenced_pulse_ids: list[str] = Field(default_factory=list)

    prompt_version: str = "pulse_memo.v1"
    provider: str = "local"
    model: str = "deterministic-pulse-memo-v1"
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _normalize_workspace_id(cls, value: str | None) -> str:
        return normalize_workspace_id(value)

    @field_validator("memo_type", mode="before")
    @classmethod
    def _normalize_memo_type(cls, value: str | None) -> str:
        return str(value or "manual").strip().lower() or "manual"

    @model_validator(mode="after")
    def _validate_window_and_lists(self) -> "ThesisPulseMemo":
        if self.window_end < self.window_start:
            raise ValueError("window_end must be greater than or equal to window_start")
        self.what_changed = _dedupe(self.what_changed)
        self.why_it_matters = _dedupe(self.why_it_matters)
        self.what_to_watch_next = _dedupe(self.what_to_watch_next)
        self.referenced_pulse_ids = _dedupe(self.referenced_pulse_ids)
        return self


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result
