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
    OutcomeAnalytics,
    OutcomeReview,
    ResearchDebate,
    ResearchRun,
    RetrospectiveInsight,
    Scenario,
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

    def get_outcome_review(self, review_id: str) -> OutcomeReview | None:
        return self.repo.get_outcome_review(review_id)

    def list_outcome_reviews(
        self,
        *,
        thesis_id: str | None = None,
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[OutcomeReview]:
        reviews = self.repo.list_outcome_reviews(thesis_id=thesis_id, limit=limit)
        if not symbol:
            return reviews
        filtered = []
        for review in reviews:
            thesis = self.repo.get_thesis(review.thesis_id)
            if thesis and thesis.symbol == symbol:
                filtered.append(review)
        return filtered

    def build_outcome_analytics(
        self,
        *,
        symbol: str | None = None,
        limit: int = 100,
    ) -> OutcomeAnalytics:
        reviews = self.list_outcome_reviews(symbol=symbol, limit=limit)
        result_counts: dict[str, int] = {}
        thesis_ids = []
        mfe_values = []
        mae_values = []
        lessons = []
        invalidated_count = 0

        for review in reviews:
            result_counts[review.result.value] = result_counts.get(review.result.value, 0) + 1
            thesis_ids.append(review.thesis_id)
            if review.max_favorable_excursion is not None:
                mfe_values.append(review.max_favorable_excursion)
            if review.max_adverse_excursion is not None:
                mae_values.append(review.max_adverse_excursion)
            if review.invalidated:
                invalidated_count += 1
            if review.lessons.strip():
                lessons.append(review.lessons.strip())

        sample_size = len(reviews)
        hit_count = result_counts.get("hit_target", 0)
        mixed_count = result_counts.get("mixed", 0)
        analytics = OutcomeAnalytics(
            sample_size=sample_size,
            symbol=symbol,
            result_counts=result_counts,
            hit_rate=_rate(hit_count, sample_size),
            invalidation_rate=_rate(invalidated_count, sample_size),
            mixed_rate=_rate(mixed_count, sample_size),
            average_mfe=_average(mfe_values),
            average_mae=_average(mae_values),
            reviewed_thesis_ids=thesis_ids,
            recent_lessons=lessons[:10],
        )
        analytics.insights = _build_retrospective_insights(analytics, reviews)
        return analytics

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

    def save_scenario(self, scenario: Scenario) -> Scenario:
        return self.save_scenarios([scenario])[0]

    def save_scenarios(self, scenarios: list[Scenario]) -> list[Scenario]:
        saved = self.repo.save_scenarios(scenarios)
        if not saved:
            return saved

        thesis_id = saved[0].thesis_id
        thesis = self.repo.get_thesis(thesis_id) if thesis_id else None
        if thesis and thesis.research_run_id:
            self.repo.add_run_event(
                thesis.research_run_id,
                "scenarios_saved",
                f"Saved {len(saved)} scenario(s) for {thesis.symbol}",
                {"scenario_ids": [scenario.id for scenario in saved if scenario.id]},
                thesis_id=thesis.id,
            )
        return saved

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        return self.repo.get_scenario(scenario_id)

    def list_scenarios(self, *, thesis_id: str, limit: int = 20) -> list[Scenario]:
        return self.repo.list_scenarios(thesis_id=thesis_id, limit=limit)


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _build_retrospective_insights(
    analytics: OutcomeAnalytics,
    reviews: list[OutcomeReview],
) -> list[RetrospectiveInsight]:
    if analytics.sample_size == 0:
        return [
            RetrospectiveInsight(
                insight_type="insufficient_data",
                message="No reviewed outcomes yet. Record outcome reviews before trusting analytics.",
            )
        ]

    insights: list[RetrospectiveInsight] = []
    if analytics.sample_size < 5:
        insights.append(
            RetrospectiveInsight(
                insight_type="small_sample",
                message="Outcome sample is still small; treat rates as directional, not reliable.",
                thesis_ids=analytics.reviewed_thesis_ids,
                evidence_count=analytics.sample_size,
            )
        )

    if analytics.invalidation_rate is not None and analytics.invalidation_rate >= 0.4:
        invalidated_ids = [
            review.thesis_id
            for review in reviews
            if review.invalidated or review.result.value == "invalidated"
        ]
        insights.append(
            RetrospectiveInsight(
                insight_type="high_invalidation_rate",
                message="Invalidation rate is elevated; tighten thesis invalidation criteria and monitor contradiction signals earlier.",
                thesis_ids=invalidated_ids,
                evidence_count=len(invalidated_ids),
            )
        )

    if analytics.hit_rate is not None and analytics.hit_rate >= 0.5:
        hit_ids = [
            review.thesis_id
            for review in reviews
            if review.result.value == "hit_target"
        ]
        insights.append(
            RetrospectiveInsight(
                insight_type="positive_hit_rate",
                message="Reviewed theses are hitting targets often enough to study common supporting evidence.",
                thesis_ids=hit_ids,
                evidence_count=len(hit_ids),
            )
        )

    if (
        analytics.average_mfe is not None
        and analytics.average_mae is not None
        and abs(analytics.average_mae) > abs(analytics.average_mfe)
    ):
        insights.append(
            RetrospectiveInsight(
                insight_type="adverse_excursion_dominates",
                message="Average adverse excursion exceeds favorable excursion; review entries, invalidation levels, and wait-for-confirmation discipline.",
                thesis_ids=analytics.reviewed_thesis_ids,
                evidence_count=analytics.sample_size,
            )
        )

    lesson_ids = [review.thesis_id for review in reviews if review.lessons.strip()]
    if lesson_ids:
        insights.append(
            RetrospectiveInsight(
                insight_type="recent_lessons_available",
                message="Recent reviewed theses contain lessons that should be injected into future research context.",
                thesis_ids=lesson_ids[:10],
                evidence_count=len(lesson_ids),
            )
        )

    return insights or [
        RetrospectiveInsight(
            insight_type="no_strong_pattern",
            message="No strong retrospective pattern detected yet; keep reviewing outcomes.",
            thesis_ids=analytics.reviewed_thesis_ids,
            evidence_count=analytics.sample_size,
        )
    ]
