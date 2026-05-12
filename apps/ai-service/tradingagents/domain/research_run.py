"""Research run lifecycle model."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class ResearchRunStatus(str, Enum):
    """Lifecycle state for a research run."""

    CREATED = "created"
    RUNNING = "running"
    COMPLETED = "completed"
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
    symbol: str
    asset_class: str = "crypto"
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
