"""Decision journal service.

This is the application boundary between graph/domain objects and SQLite.
CLI, graph, and future API/web layers should use this service instead of
talking to SQLite directly.
"""

from __future__ import annotations

from pathlib import Path

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    AgentOpinion,
    MarketSnapshot,
    OutcomeReview,
    ResearchDebate,
    ResearchRun,
    Signal,
    SignalSnapshot,
    TimelineEvent,
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

    def update_research_run(self, run: ResearchRun) -> ResearchRun:
        return self.repo.save_research_run(run)

    def add_run_event(
        self,
        research_run_id: str,
        event_type: str,
        message: str,
        payload: dict | None = None,
        *,
        thesis_id: str | None = None,
    ) -> TimelineEvent:
        return self.repo.add_run_event(
            research_run_id,
            event_type,
            message,
            payload,
            thesis_id=thesis_id,
        )

    def save_signal(self, signal: Signal) -> Signal:
        return self.repo.save_signal(signal)

    def save_market_snapshot(self, snapshot: MarketSnapshot) -> MarketSnapshot:
        return self.repo.save_market_snapshot(snapshot)

    def get_market_snapshot(self, snapshot_id: str) -> MarketSnapshot | None:
        return self.repo.get_market_snapshot(snapshot_id)

    def save_signals(self, signals: list[Signal]) -> list[Signal]:
        return self.repo.save_signals(signals)

    def get_signal(self, signal_id: str) -> Signal | None:
        return self.repo.get_signal(signal_id)

    def list_signals(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[Signal]:
        return self.repo.list_signals(symbol=symbol, limit=limit)

    def save_signal_snapshot(self, snapshot: SignalSnapshot) -> SignalSnapshot:
        return self.repo.save_signal_snapshot(snapshot)

    def get_signal_snapshot(self, snapshot_id: str) -> SignalSnapshot | None:
        return self.repo.get_signal_snapshot(snapshot_id)

    def save_agent_opinions(self, opinions: list[AgentOpinion]) -> list[AgentOpinion]:
        return self.repo.save_agent_opinions(opinions)

    def list_agent_opinions(
        self,
        *,
        research_run_id: str | None = None,
        debate_id: str | None = None,
        limit: int = 100,
    ) -> list[AgentOpinion]:
        return self.repo.list_agent_opinions(
            research_run_id=research_run_id,
            debate_id=debate_id,
            limit=limit,
        )

    def save_debate(self, debate: ResearchDebate) -> ResearchDebate:
        is_new = debate.id is None
        saved = self.repo.save_debate(debate)
        if is_new and saved.research_run_id:
            self.repo.add_run_event(
                saved.research_run_id,
                "research_debate_saved",
                f"Research debate saved for {saved.symbol}",
                {"debate_id": saved.id, "opinion_ids": saved.opinion_ids},
            )
        return saved

    def get_debate(self, debate_id: str) -> ResearchDebate | None:
        return self.repo.get_debate(debate_id)

    def save_thesis(self, thesis: TradeThesis) -> TradeThesis:
        is_new = thesis.id is None
        saved = self.repo.save_thesis(thesis)
        if is_new and saved.research_run_id:
            self.repo.add_run_event(
                saved.research_run_id,
                "trade_thesis_saved",
                f"Trade thesis saved for {saved.symbol}",
                {"thesis_id": saved.id},
                thesis_id=saved.id,
            )
        return saved

    def record_user_decision(self, decision: UserDecision) -> UserDecision:
        saved = self.repo.save_user_decision(decision)
        thesis = self.repo.get_thesis(saved.thesis_id)
        if thesis and thesis.research_run_id:
            run = self.repo.get_research_run(thesis.research_run_id)
            if run:
                run.user_decision_id = saved.id
                self.repo.save_research_run(run)
            self.repo.add_run_event(
                thesis.research_run_id,
                "user_decision_recorded",
                f"User decision recorded: {saved.action.value}",
                {
                    "decision_id": saved.id,
                    "action": saved.action.value,
                    "user_notes": saved.user_notes,
                },
                thesis_id=saved.thesis_id,
            )
        return saved

    def record_outcome_review(self, review: OutcomeReview) -> OutcomeReview:
        saved = self.repo.save_outcome_review(review)
        thesis = self.repo.get_thesis(saved.thesis_id)
        if thesis and thesis.research_run_id:
            run = self.repo.get_research_run(thesis.research_run_id)
            if run:
                run.outcome_review_id = saved.id
                self.repo.save_research_run(run)
            self.repo.add_run_event(
                thesis.research_run_id,
                "outcome_review_recorded",
                f"Outcome review recorded: {saved.result.value}",
                {
                    "outcome_review_id": saved.id,
                    "result": saved.result.value,
                    "invalidated": saved.invalidated,
                    "lessons": saved.lessons,
                },
                thesis_id=saved.thesis_id,
            )
        return saved

    def list_timeline_events(
        self,
        *,
        research_run_id: str | None = None,
        thesis_id: str | None = None,
        limit: int = 200,
    ) -> list[TimelineEvent]:
        return self.repo.list_timeline_events(
            research_run_id=research_run_id,
            thesis_id=thesis_id,
            limit=limit,
        )

    def list_research_runs(self, limit: int = 20) -> list[ResearchRun]:
        return self.repo.list_research_runs(limit=limit)

    def get_research_run(self, run_id: str) -> ResearchRun | None:
        return self.repo.get_research_run(run_id)

    def list_theses(self, limit: int = 20) -> list[TradeThesis]:
        return self.repo.list_theses(limit=limit)

    def get_thesis(self, thesis_id: str) -> TradeThesis | None:
        return self.repo.get_thesis(thesis_id)
