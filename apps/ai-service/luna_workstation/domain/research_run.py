"""Research run lifecycle model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from .tenancy import normalize_workspace_id


class ResearchRunStatus(str, Enum):
    """Lifecycle state for a research run."""

    CREATED = "created"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_DEGRADED = "completed_degraded"
    FAILED = "failed"


class ResearchRun(BaseModel):
    """A single research workflow from market snapshot to thesis.

    Model identity and config provenance fields (deep_think_model,
    quick_think_model, llm_provider, config_hash) capture which LLMs
    and configuration snapshot produced this run, enabling:
    - Reproducibility: re-run with the same models/config
    - Audit: trace decisions back to specific model versions
    - Deprecation tracking: identify runs affected by model EOL
    """

    id: str | None = None
    workspace_id: str = "local"
    symbol: str
    asset_class: str = "crypto"
    market_type: str = "spot"
    timeframe: str | None = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None

    # Model identity — which LLMs produced this run
    deep_think_model: str | None = None
    quick_think_model: str | None = None
    llm_provider: str | None = None

    # Config provenance — deterministic hash of effective config (secrets redacted)
    config_hash: str | None = None

    # Snapshot and artifact references
    market_snapshot_id: str | None = None
    signal_snapshot_id: str | None = None
    signal_ids: list[str] = Field(default_factory=list)
    debate_id: str | None = None
    thesis_id: str | None = None
    decision_id: str | None = None
    user_decision_id: str | None = None
    outcome_review_id: str | None = None
    status: ResearchRunStatus = ResearchRunStatus.CREATED
    degradation_reasons: list[str] = Field(default_factory=list)
    missing_core_data: list[str] = Field(default_factory=list)
    missing_optional_data: list[str] = Field(default_factory=list)

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

    def has_degradation(self) -> bool:
        return bool(
            self.degradation_reasons
            or self.missing_core_data
            or self.missing_optional_data
            or self.status == ResearchRunStatus.COMPLETED_DEGRADED
        )

    def completion_label(self) -> str:
        if self.status == ResearchRunStatus.COMPLETED_DEGRADED:
            return "completed (degraded)"
        if self.status == ResearchRunStatus.COMPLETED:
            return "completed (clean)"
        return self.status.value
