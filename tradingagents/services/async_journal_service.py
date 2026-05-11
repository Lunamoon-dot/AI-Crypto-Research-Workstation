"""Async boundary wrappers for the synchronous journal service."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from .journal_service import JournalService


class AsyncJournalService:
    """Async facade that preserves the sync journal implementation."""

    def __init__(self, config: dict[str, Any] | None = None):
        self._sync = JournalService(config)

    @property
    def db_path(self) -> Path:
        return self._sync.db_path

    async def run_sync(self, method_name: str, *args, **kwargs):
        method = getattr(self._sync, method_name)
        return await asyncio.to_thread(method, *args, **kwargs)

    async def migrate(self):
        return await self.run_sync("migrate")

    async def start_research_run(self, run):
        return await self.run_sync("start_research_run", run)

    async def complete_research_run(self, run):
        return await self.run_sync("complete_research_run", run)

    async def update_research_run(self, run):
        return await self.run_sync("update_research_run", run)

    async def add_run_event(self, *args, **kwargs):
        return await self.run_sync("add_run_event", *args, **kwargs)

    async def save_thesis(self, thesis):
        return await self.run_sync("save_thesis", thesis)

    async def get_thesis(self, thesis_id: str):
        return await self.run_sync("get_thesis", thesis_id)

    async def get_research_run(self, run_id: str):
        return await self.run_sync("get_research_run", run_id)

    async def list_research_runs(self, limit: int = 20):
        return await self.run_sync("list_research_runs", limit)

    async def list_timeline_events(self, **kwargs):
        return await self.run_sync("list_timeline_events", **kwargs)

    async def save_signal(self, signal):
        return await self.run_sync("save_signal", signal)

    async def save_signals(self, signals):
        return await self.run_sync("save_signals", signals)

    async def list_signals(self, **kwargs):
        return await self.run_sync("list_signals", **kwargs)
