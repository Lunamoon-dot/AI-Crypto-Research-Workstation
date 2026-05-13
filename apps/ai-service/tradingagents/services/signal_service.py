"""Application service for saved signal provenance workflows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import ResearchRun, Signal, SignalSnapshot
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

    def get_latest_snapshot(
        self, symbol: str
    ) -> tuple[ResearchRun | None, SignalSnapshot | None, list[Signal]]:
        snapshot = self.journal.get_latest_signal_snapshot(symbol)
        return self._snapshot_bundle(snapshot)

    def get_snapshot_for_run(
        self, run_id: str
    ) -> tuple[ResearchRun | None, SignalSnapshot | None, list[Signal]]:
        run = self.journal.get_research_run(run_id, workspace_id=self.workspace_id)
        if not run:
            return None, None, []
        snapshot = None
        if run.signal_snapshot_id:
            snapshot = self.journal.get_signal_snapshot(run.signal_snapshot_id)
        if snapshot is None and run.id:
            snapshot = self.journal.get_signal_snapshot_for_run(run.id)
        signals = self._signals_for_snapshot(snapshot)
        return run, snapshot, signals

    def explain_signal(
        self, signal_id: str
    ) -> tuple[Signal | None, ResearchRun | None, SignalSnapshot | None]:
        signal = self.get_signal(signal_id)
        if not signal:
            return None, None, None
        snapshot = self.journal.get_signal_snapshot_for_signal(signal_id)
        run = None
        if snapshot:
            run = self.journal.get_research_run(
                snapshot.research_run_id,
                workspace_id=self.workspace_id,
            )
        return signal, run, snapshot

    def _snapshot_bundle(
        self, snapshot: SignalSnapshot | None
    ) -> tuple[ResearchRun | None, SignalSnapshot | None, list[Signal]]:
        if not snapshot:
            return None, None, []
        run = self.journal.get_research_run(
            snapshot.research_run_id,
            workspace_id=self.workspace_id,
        )
        return run, snapshot, self._signals_for_snapshot(snapshot)

    def _signals_for_snapshot(self, snapshot: SignalSnapshot | None) -> list[Signal]:
        if not snapshot:
            return []
        signal_map = self.journal.get_signals_by_ids(snapshot.signal_ids)
        return [
            signal_map[signal_id]
            for signal_id in snapshot.signal_ids
            if signal_id in signal_map
        ]
