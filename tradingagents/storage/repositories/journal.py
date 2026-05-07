"""SQLite repositories for research journal entities."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from uuid import uuid4

from tradingagents.domain import (
    AgentOpinion,
    MarketSnapshot,
    OutcomeReview,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    SignalSnapshot,
    TimelineEvent,
    TradeThesis,
    UserDecision,
)
from tradingagents.storage.serialization import dumps_payload, model_from_json, model_to_json
from tradingagents.storage.sqlite import SQLiteStore


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _iso(dt) -> str | None:
    return dt.isoformat() if dt is not None else None


class JournalRepository:
    """CRUD boundary for the local decision journal."""

    def __init__(self, store: SQLiteStore):
        self.store = store

    def save_research_run(self, run: ResearchRun) -> ResearchRun:
        if not run.id:
            run.id = _new_id("run")
        self.store.execute(
            """
            INSERT INTO research_runs (
                id, symbol, asset_class, timeframe, status, started_at,
                completed_at, market_snapshot_id, signal_snapshot_id, debate_id,
                thesis_id, user_decision_id, outcome_review_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                symbol=excluded.symbol,
                asset_class=excluded.asset_class,
                timeframe=excluded.timeframe,
                status=excluded.status,
                completed_at=excluded.completed_at,
                market_snapshot_id=excluded.market_snapshot_id,
                signal_snapshot_id=excluded.signal_snapshot_id,
                debate_id=excluded.debate_id,
                thesis_id=excluded.thesis_id,
                user_decision_id=excluded.user_decision_id,
                outcome_review_id=excluded.outcome_review_id,
                payload_json=excluded.payload_json
            """,
            (
                run.id,
                run.symbol,
                run.asset_class,
                run.timeframe,
                run.status.value,
                _iso(run.started_at),
                _iso(run.completed_at),
                run.market_snapshot_id,
                run.signal_snapshot_id,
                run.debate_id,
                run.thesis_id,
                run.user_decision_id,
                run.outcome_review_id,
                model_to_json(run),
            ),
        )
        return run

    def complete_research_run(self, run: ResearchRun) -> ResearchRun:
        run.status = ResearchRunStatus.COMPLETED
        run.completed_at = datetime.now(timezone.utc)
        return self.save_research_run(run)

    def get_research_run(self, run_id: str) -> ResearchRun | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM research_runs WHERE id = ?", (run_id,)
        )
        return model_from_json(ResearchRun, row["payload_json"]) if row else None

    def list_research_runs(self, limit: int = 20) -> list[ResearchRun]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM research_runs
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [model_from_json(ResearchRun, row["payload_json"]) for row in rows]

    def save_market_snapshot(self, snapshot: MarketSnapshot) -> MarketSnapshot:
        if not snapshot.id:
            snapshot.id = _new_id("market_snapshot")
        self.store.execute(
            """
            INSERT INTO market_snapshots (
                id, research_run_id, symbol, captured_at, current_price,
                source, source_timestamp, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                research_run_id=excluded.research_run_id,
                current_price=excluded.current_price,
                payload_json=excluded.payload_json
            """,
            (
                snapshot.id,
                snapshot.research_run_id,
                snapshot.symbol,
                _iso(snapshot.captured_at),
                snapshot.current_price,
                snapshot.source,
                _iso(snapshot.source_timestamp),
                model_to_json(snapshot),
            ),
        )
        return snapshot

    def get_market_snapshot(self, snapshot_id: str) -> MarketSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM market_snapshots WHERE id = ?", (snapshot_id,)
        )
        return model_from_json(MarketSnapshot, row["payload_json"]) if row else None

    def save_signal(self, signal: Signal) -> Signal:
        if not signal.id:
            signal.id = _new_id("sig")
        self.store.execute(
            """
            INSERT INTO signals (
                id, symbol, signal_type, direction, confidence, observed_at,
                source, source_timestamp, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                direction=excluded.direction,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                signal.id,
                signal.symbol,
                signal.signal_type,
                signal.direction.value,
                signal.confidence,
                _iso(signal.observed_at),
                signal.provenance.source,
                _iso(signal.provenance.source_timestamp),
                model_to_json(signal),
            ),
        )
        return signal

    def save_signals(self, signals: list[Signal]) -> list[Signal]:
        return [self.save_signal(signal) for signal in signals]

    def get_signal(self, signal_id: str) -> Signal | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signals WHERE id = ?", (signal_id,)
        )
        return model_from_json(Signal, row["payload_json"]) if row else None

    def list_signals(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[Signal]:
        if symbol:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM signals
                WHERE symbol = ?
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM signals
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(Signal, row["payload_json"]) for row in rows]

    def save_signal_snapshot(self, snapshot: SignalSnapshot) -> SignalSnapshot:
        if not snapshot.id:
            snapshot.id = _new_id("signal_snapshot")
        self.store.execute(
            """
            INSERT INTO signal_snapshots (
                id, research_run_id, symbol, captured_at, composite_signal_id,
                signal_count, bullish_count, bearish_count, neutral_count,
                stale_count, unknown_freshness_count, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                composite_signal_id=excluded.composite_signal_id,
                signal_count=excluded.signal_count,
                bullish_count=excluded.bullish_count,
                bearish_count=excluded.bearish_count,
                neutral_count=excluded.neutral_count,
                stale_count=excluded.stale_count,
                unknown_freshness_count=excluded.unknown_freshness_count,
                payload_json=excluded.payload_json
            """,
            (
                snapshot.id,
                snapshot.research_run_id,
                snapshot.symbol,
                _iso(snapshot.captured_at),
                snapshot.composite_signal_id,
                len(snapshot.signal_ids),
                snapshot.bullish_count,
                snapshot.bearish_count,
                snapshot.neutral_count,
                snapshot.stale_count,
                snapshot.unknown_freshness_count,
                model_to_json(snapshot),
            ),
        )
        return snapshot

    def get_signal_snapshot(self, snapshot_id: str) -> SignalSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signal_snapshots WHERE id = ?", (snapshot_id,)
        )
        return model_from_json(SignalSnapshot, row["payload_json"]) if row else None

    def save_agent_opinion(self, opinion: AgentOpinion) -> AgentOpinion:
        if not opinion.id:
            opinion.id = _new_id("opinion")
        self.store.execute(
            """
            INSERT INTO agent_opinions (
                id, research_run_id, debate_id, agent_name, role, stance,
                confidence, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                debate_id=excluded.debate_id,
                stance=excluded.stance,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                opinion.id,
                opinion.research_run_id,
                opinion.debate_id,
                opinion.agent_name,
                opinion.role,
                opinion.stance.value,
                opinion.confidence,
                _iso(opinion.created_at),
                model_to_json(opinion),
            ),
        )
        return opinion

    def save_agent_opinions(self, opinions: list[AgentOpinion]) -> list[AgentOpinion]:
        return [self.save_agent_opinion(opinion) for opinion in opinions]

    def get_agent_opinion(self, opinion_id: str) -> AgentOpinion | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM agent_opinions WHERE id = ?", (opinion_id,)
        )
        return model_from_json(AgentOpinion, row["payload_json"]) if row else None

    def list_agent_opinions(
        self,
        *,
        research_run_id: str | None = None,
        debate_id: str | None = None,
        limit: int = 100,
    ) -> list[AgentOpinion]:
        if debate_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                WHERE debate_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (debate_id, limit),
            )
        elif research_run_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                WHERE research_run_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (research_run_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(AgentOpinion, row["payload_json"]) for row in rows]

    def save_debate(self, debate: ResearchDebate) -> ResearchDebate:
        if not debate.id:
            debate.id = _new_id("debate")
        self.store.execute(
            """
            INSERT INTO debates (
                id, research_run_id, symbol, consensus_stance, conflict_level,
                created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                consensus_stance=excluded.consensus_stance,
                conflict_level=excluded.conflict_level,
                payload_json=excluded.payload_json
            """,
            (
                debate.id,
                debate.research_run_id,
                debate.symbol,
                debate.consensus_stance.value,
                debate.conflict_level.value,
                _iso(debate.created_at),
                model_to_json(debate),
            ),
        )
        return debate

    def get_debate(self, debate_id: str) -> ResearchDebate | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM debates WHERE id = ?", (debate_id,)
        )
        return model_from_json(ResearchDebate, row["payload_json"]) if row else None

    def save_thesis(self, thesis: TradeThesis) -> TradeThesis:
        if not thesis.id:
            thesis.id = _new_id("thesis")
        self.store.execute(
            """
            INSERT INTO trade_theses (
                id, research_run_id, symbol, direction, setup_type,
                confidence, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                research_run_id=excluded.research_run_id,
                direction=excluded.direction,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                thesis.id,
                thesis.research_run_id,
                thesis.symbol,
                thesis.direction.value,
                thesis.setup_type,
                thesis.confidence,
                _iso(thesis.created_at),
                model_to_json(thesis),
            ),
        )
        return thesis

    def get_thesis(self, thesis_id: str) -> TradeThesis | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM trade_theses WHERE id = ?", (thesis_id,)
        )
        return model_from_json(TradeThesis, row["payload_json"]) if row else None

    def list_theses(self, limit: int = 20) -> list[TradeThesis]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM trade_theses
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [model_from_json(TradeThesis, row["payload_json"]) for row in rows]

    def find_thesis_by_id(self, thesis_id: str) -> TradeThesis | None:
        return self.get_thesis(thesis_id)

    def save_user_decision(self, decision: UserDecision) -> UserDecision:
        if not decision.id:
            decision.id = _new_id("decision")
        self.store.execute(
            """
            INSERT INTO user_decisions (
                id, thesis_id, action, decided_at, user_notes, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                action=excluded.action,
                user_notes=excluded.user_notes,
                payload_json=excluded.payload_json
            """,
            (
                decision.id,
                decision.thesis_id,
                decision.action.value,
                _iso(decision.decided_at),
                decision.user_notes,
                model_to_json(decision),
            ),
        )
        return decision

    def save_outcome_review(self, review: OutcomeReview) -> OutcomeReview:
        if not review.id:
            review.id = _new_id("outcome")
        self.store.execute(
            """
            INSERT INTO outcome_reviews (
                id, thesis_id, result, reviewed_at, invalidated, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                result=excluded.result,
                invalidated=excluded.invalidated,
                payload_json=excluded.payload_json
            """,
            (
                review.id,
                review.thesis_id,
                review.result.value,
                _iso(review.reviewed_at),
                1 if review.invalidated else 0,
                model_to_json(review),
            ),
        )
        return review

    def add_run_event(
        self,
        research_run_id: str,
        event_type: str,
        message: str,
        payload: dict | None = None,
        *,
        thesis_id: str | None = None,
    ) -> TimelineEvent:
        event = TimelineEvent(
            id=_new_id("event"),
            research_run_id=research_run_id,
            thesis_id=thesis_id,
            event_type=event_type,
            message=message,
            payload=payload or {},
        )
        self.store.execute(
            """
            INSERT INTO run_events (
                id, research_run_id, thesis_id, event_type, created_at, message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.id,
                event.research_run_id,
                event.thesis_id,
                event.event_type,
                _iso(event.created_at),
                event.message,
                dumps_payload(event.payload),
            ),
        )
        return event

    def list_timeline_events(
        self,
        *,
        research_run_id: str | None = None,
        thesis_id: str | None = None,
        limit: int = 200,
    ) -> list[TimelineEvent]:
        if thesis_id:
            rows = self.store.fetchall(
                """
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json
                FROM run_events
                WHERE thesis_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (thesis_id, limit),
            )
        elif research_run_id:
            rows = self.store.fetchall(
                """
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json
                FROM run_events
                WHERE research_run_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (research_run_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json
                FROM run_events
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [self._timeline_event_from_row(row) for row in rows]

    @staticmethod
    def _timeline_event_from_row(row) -> TimelineEvent:
        return TimelineEvent(
            id=row["id"],
            research_run_id=row["research_run_id"],
            thesis_id=row["thesis_id"],
            event_type=row["event_type"],
            created_at=datetime.fromisoformat(row["created_at"]),
            message=row["message"],
            payload=json.loads(row["payload_json"] or "{}"),
        )
