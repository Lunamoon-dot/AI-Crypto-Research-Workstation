"""Decision journal service.

This is the application boundary between graph/domain objects and SQLite.
CLI, graph, and future API/web layers should use this service instead of
talking to SQLite directly.
"""

from __future__ import annotations

from pathlib import Path

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    OutcomeReview,
    ResearchRun,
    Signal,
    TradeThesis,
    UserDecision,
)
from tradingagents.storage.repositories import JournalRepository
from tradingagents.storage.sqlite import SQLiteStore


def resolve_journal_db_path(config: dict | None = None) -> Path:
    cfg = config or DEFAULT_CONFIG
    journal_cfg = cfg.get("journal", {})
    db_path = journal_cfg.get("db_path") or cfg.get("journal_db_path")
    if db_path:
        return Path(db_path).expanduser()
    return Path(cfg["data_cache_dir"]).expanduser() / "research_journal.sqlite"


class JournalService:
    """High-level operations for research runs, theses, decisions, and reviews."""

    def __init__(self, config: dict | None = None):
        self.config = config or DEFAULT_CONFIG
        self.store = SQLiteStore(resolve_journal_db_path(self.config))
        self.repo = JournalRepository(self.store)

    @property
    def db_path(self) -> Path:
        return self.store.path

    def start_research_run(self, run: ResearchRun) -> ResearchRun:
        saved = self.repo.save_research_run(run)
        self.repo.add_run_event(saved.id, "research_run_started", "Research run started")
        return saved

    def complete_research_run(self, run: ResearchRun) -> ResearchRun:
        saved = self.repo.complete_research_run(run)
        self.repo.add_run_event(saved.id, "research_run_completed", "Research run completed")
        return saved

    def save_signal(self, signal: Signal) -> Signal:
        return self.repo.save_signal(signal)

    def save_thesis(self, thesis: TradeThesis) -> TradeThesis:
        saved = self.repo.save_thesis(thesis)
        if saved.research_run_id:
            self.repo.add_run_event(
                saved.research_run_id,
                "trade_thesis_saved",
                f"Trade thesis saved for {saved.symbol}",
                {"thesis_id": saved.id},
            )
        return saved

    def record_user_decision(self, decision: UserDecision) -> UserDecision:
        return self.repo.save_user_decision(decision)

    def record_outcome_review(self, review: OutcomeReview) -> OutcomeReview:
        return self.repo.save_outcome_review(review)

    def list_research_runs(self, limit: int = 20) -> list[ResearchRun]:
        return self.repo.list_research_runs(limit=limit)

    def get_research_run(self, run_id: str) -> ResearchRun | None:
        return self.repo.get_research_run(run_id)

    def list_theses(self, limit: int = 20) -> list[TradeThesis]:
        return self.repo.list_theses(limit=limit)

    def get_thesis(self, thesis_id: str) -> TradeThesis | None:
        return self.repo.get_thesis(thesis_id)
