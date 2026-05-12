"""Application service for saved signal provenance workflows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import Signal
from tradingagents.domain.tenancy import normalize_workspace_id

from .journal_service import JournalService


class SignalService:
    """Facade for CLI and app signal provenance reads."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        *,
        journal_service_factory: Callable[[dict[str, Any]], JournalService] = (
            JournalService
        ),
    ) -> None:
        self.config = config or DEFAULT_CONFIG
        engine_cfg = self.config.get("_engine") or {}
        self.workspace_id = normalize_workspace_id(
            engine_cfg.get("workspace_id") or self.config.get("workspace_id")
        )
        self.journal = journal_service_factory(self.config)

    def list_signals(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[Signal]:
        return self.journal.list_signals(
            symbol=symbol,
            limit=limit,
            workspace_id=self.workspace_id,
        )

    def get_signal(self, signal_id: str) -> Signal | None:
        return self.journal.get_signal(signal_id)
