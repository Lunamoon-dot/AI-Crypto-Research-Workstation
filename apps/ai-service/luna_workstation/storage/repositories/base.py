"""Shared helpers for SQLite journal aggregate repositories."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Any
import json
from uuid import uuid4

from luna_workstation.domain import (
    AgentOpinion,
    MarketSnapshot,
    OutcomeReview,
    ProviderHealthRecord,
    LLMCallRecord,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Scenario,
    Signal,
    SignalSnapshot,
    ThesisEvaluation,
    TimelineEvent,
    TradeThesis,
    UserDecision,
    DataFreshnessCheck,
)
from luna_workstation.storage.serialization import (
    dumps_payload,
    model_from_json,
    model_to_json,
)
from luna_workstation.storage.sqlite import SQLiteStore


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _chunks(items: list[str], size: int = 900) -> Iterator[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _iso(dt) -> str | None:
    return dt.isoformat() if dt is not None else None


class RepositoryMixinBase:
    """Store contract shared by aggregate repository mixins."""

    store: SQLiteStore


class JournalRepositoryBase(RepositoryMixinBase):
    """Base store holder shared by aggregate repository mixins."""

    def __init__(self, store: SQLiteStore):
        self.store = store


__all__ = [
    "AgentOpinion",
    "Any",
    "DataFreshnessCheck",
    "Iterator",
    "JournalRepositoryBase",
    "LLMCallRecord",
    "MarketSnapshot",
    "OutcomeReview",
    "ProviderHealthRecord",
    "ResearchDebate",
    "RepositoryMixinBase",
    "ResearchRun",
    "ResearchRunStatus",
    "Scenario",
    "Signal",
    "SignalSnapshot",
    "SQLiteStore",
    "ThesisEvaluation",
    "TimelineEvent",
    "TradeThesis",
    "UserDecision",
    "_chunks",
    "_iso",
    "_new_id",
    "datetime",
    "dumps_payload",
    "json",
    "model_from_json",
    "model_to_json",
    "timezone",
]
