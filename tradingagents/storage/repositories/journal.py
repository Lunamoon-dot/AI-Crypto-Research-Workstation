"""SQLite repositories for research journal entities."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from tradingagents.domain import (
    OutcomeReview,
    ResearchRun,
    ResearchRunStatus,
    Signal,
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
                completed_at, market_snapshot_id, thesis_id, user_decision_id,
                outcome_review_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                symbol=excluded.symbol,
                asset_class=excluded.asset_class,
                timeframe=excluded.timeframe,
                status=excluded.status,
                completed_at=excluded.completed_at,
                market_snapshot_id=excluded.market_snapshot_id,
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
        self, research_run_id: str, event_type: str, message: str, payload: dict | None = None
    ) -> str:
        event_id = _new_id("event")
        created_at = datetime.now(timezone.utc).isoformat()
        self.store.execute(
            """
            INSERT INTO run_events (
                id, research_run_id, event_type, created_at, message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                research_run_id,
                event_type,
                created_at,
                message,
                dumps_payload(payload or {}),
            ),
        )
        return event_id
