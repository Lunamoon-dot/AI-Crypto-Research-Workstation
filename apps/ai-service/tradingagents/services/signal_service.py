"""Application service for saved signal provenance workflows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import Signal

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
        self.journal = journal_service_factory(self.config)

    def list_signals(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[Signal]:
        return self.journal.list_signals(symbol=symbol, limit=limit)

    def get_signal(self, signal_id: str) -> Signal | None:
        return self.journal.get_signal(signal_id)
