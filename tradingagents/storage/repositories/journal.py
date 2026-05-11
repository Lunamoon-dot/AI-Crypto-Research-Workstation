"""SQLite repositories for research journal entities."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import json
from uuid import uuid4

from tradingagents.domain import (
    AgentOpinion,
    Alert,
    MarketBrief,
    MarketSnapshot,
    OutcomeReview,
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
    Watchlist,
    WatchlistItem,
)
from tradingagents.storage.serialization import (
    dumps_payload,
    model_from_json,
    model_to_json,
)
from tradingagents.storage.sqlite import SQLiteStore


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _iso(dt) -> str | None:
    return dt.isoformat() if dt is not None else None


class JournalRepository:
    """CRUD boundary for the local decision journal."""

    def __init__(self, store: SQLiteStore):
        self.store = store

    def save_research_run(self, run: ResearchRun, *, _conn=None) -> ResearchRun:
        if not run.id:
            run.id = _new_id("run")
        self.store.execute(
            """
            INSERT INTO research_runs (
                id, symbol, asset_class, timeframe, status, started_at,
                completed_at, market_snapshot_id, signal_snapshot_id, debate_id,
                thesis_id, decision_id, user_decision_id, outcome_review_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                decision_id=excluded.decision_id,
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
                run.decision_id,
                run.user_decision_id,
                run.outcome_review_id,
                model_to_json(run),
            ), _conn=_conn,
        )
        return run

    def complete_research_run(
        self, run: ResearchRun, *, _conn=None
    ) -> ResearchRun:
        run.status = ResearchRunStatus.COMPLETED
        run.completed_at = datetime.now(timezone.utc)
        return self.save_research_run(run, _conn=_conn)

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

    def save_market_snapshot(
        self, snapshot: MarketSnapshot, *, _conn=None
    ) -> MarketSnapshot:
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
            _conn=_conn,
        )
        return snapshot

    def get_market_snapshot(self, snapshot_id: str) -> MarketSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM market_snapshots WHERE id = ?", (snapshot_id,)
        )
        return model_from_json(MarketSnapshot, row["payload_json"]) if row else None

    def get_latest_market_snapshot(self, symbol: str) -> MarketSnapshot | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM market_snapshots
            WHERE symbol = ? AND current_price IS NOT NULL
            ORDER BY captured_at DESC
            LIMIT 1
            """,
            (symbol,),
        )
        return model_from_json(MarketSnapshot, row["payload_json"]) if row else None

    def save_signal(self, signal: Signal, *, _conn=None) -> Signal:
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
            _conn=_conn,
        )
        return signal

    def save_signals(self, signals: list[Signal], *, _conn=None) -> list[Signal]:
        """Persist a batch of signals in a single transaction.

        Avoids the N+1 connection-open pattern of calling :meth:`save_signal`
        in a loop.  Falls back to individual saves when the batch is tiny.
        """
        if not signals:
            return []
        if len(signals) == 1:
            return [self.save_signal(signals[0], _conn=_conn)]

        # Assign ids before entering the transaction.
        for signal in signals:
            if not signal.id:
                signal.id = _new_id("sig")

        params_seq = [
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
            )
            for signal in signals
        ]

        def _execute(conn):
            conn.executemany(
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
                params_seq,
            )
        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return signals

    def get_signal(self, signal_id: str) -> Signal | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signals WHERE id = ?", (signal_id,)
        )
        return model_from_json(Signal, row["payload_json"]) if row else None

    def get_signals_by_ids(self, signal_ids: list[str]) -> dict[str, Signal]:
        """Batch-fetch multiple signals by ID. Returns {id: Signal}."""
        if not signal_ids:
            return {}
        placeholders = ", ".join(["?"] * len(signal_ids))
        rows = self.store.fetchall(
            f"SELECT payload_json FROM signals WHERE id IN ({placeholders})",
            tuple(signal_ids),
        )
        result: dict[str, Signal] = {}
        for row in rows:
            signal = model_from_json(Signal, row["payload_json"])
            if signal and signal.id:
                result[signal.id] = signal
        return result

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

    def save_signal_snapshot(
        self, snapshot: SignalSnapshot, *, _conn=None
    ) -> SignalSnapshot:
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
            _conn=_conn,
        )
        return snapshot

    def get_signal_snapshot(self, snapshot_id: str) -> SignalSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signal_snapshots WHERE id = ?", (snapshot_id,)
        )
        return model_from_json(SignalSnapshot, row["payload_json"]) if row else None

    def save_agent_opinion(self, opinion: AgentOpinion, *, _conn=None) -> AgentOpinion:
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
            _conn=_conn,
        )
        return opinion

    def save_agent_opinions(
        self, opinions: list[AgentOpinion], *, _conn=None
    ) -> list[AgentOpinion]:
        """Persist a batch of agent opinions in a single transaction.

        Avoids the N+1 connection-open pattern.  Falls back to individual
        saves when the batch is tiny.
        """
        if not opinions:
            return []
        if len(opinions) == 1:
            return [self.save_agent_opinion(opinions[0], _conn=_conn)]

        for opinion in opinions:
            if not opinion.id:
                opinion.id = _new_id("opinion")

        params_seq = [
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
            )
            for opinion in opinions
        ]

        def _execute(conn):
            conn.executemany(
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
                params_seq,
            )
        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return opinions

    def get_agent_opinion(self, opinion_id: str) -> AgentOpinion | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM agent_opinions WHERE id = ?", (opinion_id,)
        )
        return model_from_json(AgentOpinion, row["payload_json"]) if row else None

    def get_agent_opinions_by_ids(
        self, opinion_ids: list[str]
    ) -> dict[str, AgentOpinion]:
        """Batch-fetch multiple agent opinions by ID. Returns {id: AgentOpinion}."""
        if not opinion_ids:
            return {}
        placeholders = ", ".join(["?"] * len(opinion_ids))
        rows = self.store.fetchall(
            f"SELECT payload_json FROM agent_opinions WHERE id IN ({placeholders})",
            tuple(opinion_ids),
        )
        result: dict[str, AgentOpinion] = {}
        for row in rows:
            opinion = model_from_json(AgentOpinion, row["payload_json"])
            if opinion and opinion.id:
                result[opinion.id] = opinion
        return result

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

    def save_debate(self, debate: ResearchDebate, *, _conn=None) -> ResearchDebate:
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
            ), _conn=_conn,
        )
        return debate

    def get_debate(self, debate_id: str) -> ResearchDebate | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM debates WHERE id = ?", (debate_id,)
        )
        return model_from_json(ResearchDebate, row["payload_json"]) if row else None

    def save_thesis(self, thesis: TradeThesis, *, _conn=None) -> TradeThesis:
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
            ), _conn=_conn,
        )
        return thesis

    def get_thesis(self, thesis_id: str) -> TradeThesis | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM trade_theses WHERE id = ?", (thesis_id,)
        )
        return model_from_json(TradeThesis, row["payload_json"]) if row else None

    def get_theses_by_ids(self, thesis_ids: list[str]) -> dict[str, TradeThesis]:
        """Batch-fetch theses to avoid N+1 queries in evaluation analytics."""
        if not thesis_ids:
            return {}
        # SQLite has a default limit of 999 host parameters; chunk if needed.
        CHUNK = 900
        result: dict[str, TradeThesis] = {}
        for i in range(0, len(thesis_ids), CHUNK):
            chunk = thesis_ids[i : i + CHUNK]
            placeholders = ",".join("?" for _ in chunk)
            rows = self.store.fetchall(
                f"SELECT payload_json FROM trade_theses WHERE id IN ({placeholders})",
                tuple(chunk),
            )
            for row in rows:
                thesis = model_from_json(TradeThesis, row["payload_json"])
                if thesis and thesis.id:
                    result[thesis.id] = thesis
        return result

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

    def save_scenario(self, scenario: Scenario, *, _conn=None) -> Scenario:
        if not scenario.id:
            scenario.id = _new_id("scenario")
        self.store.execute(
            """
            INSERT INTO scenarios (
                id, thesis_id, probability_band, suggested_user_action, payload_json
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                probability_band=excluded.probability_band,
                suggested_user_action=excluded.suggested_user_action,
                payload_json=excluded.payload_json
            """,
            (
                scenario.id,
                scenario.thesis_id,
                scenario.probability_band.value,
                scenario.suggested_user_action,
                model_to_json(scenario),
            ), _conn=_conn,
        )
        return scenario

    def save_scenarios(self, scenarios: list[Scenario], *, _conn=None) -> list[Scenario]:
        """Persist a batch of scenarios in a single transaction.

        Avoids the N+1 connection-open pattern of calling :meth:`save_scenario`
        in a loop.  Falls back to individual saves when the batch is tiny.
        """
        if not scenarios:
            return []
        if len(scenarios) == 1:
            return [self.save_scenario(scenarios[0], _conn=_conn)]

        for scenario in scenarios:
            if not scenario.id:
                scenario.id = _new_id("scenario")

        params_seq = [
            (
                scenario.id,
                scenario.thesis_id,
                scenario.probability_band.value,
                scenario.suggested_user_action,
                model_to_json(scenario),
            )
            for scenario in scenarios
        ]

        def _execute(conn):
            conn.executemany(
                """
                INSERT INTO scenarios (
                    id, thesis_id, probability_band, suggested_user_action, payload_json
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    probability_band=excluded.probability_band,
                    suggested_user_action=excluded.suggested_user_action,
                    payload_json=excluded.payload_json
                """,
                params_seq,
            )
        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return scenarios

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM scenarios WHERE id = ?", (scenario_id,)
        )
        return model_from_json(Scenario, row["payload_json"]) if row else None

    def list_scenarios(self, *, thesis_id: str, limit: int = 20) -> list[Scenario]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM scenarios
            WHERE thesis_id = ?
            ORDER BY id
            LIMIT ?
            """,
            (thesis_id, limit),
        )
        return [model_from_json(Scenario, row["payload_json"]) for row in rows]

    def save_watchlist(self, watchlist: Watchlist) -> Watchlist:
        if not watchlist.id:
            watchlist.id = _new_id("watchlist")
        self.store.execute(
            """
            INSERT INTO watchlists (
                id, name, enabled, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                enabled=excluded.enabled,
                payload_json=excluded.payload_json
            """,
            (
                watchlist.id,
                watchlist.name,
                1 if watchlist.enabled else 0,
                _iso(watchlist.created_at),
                model_to_json(watchlist),
            ),
        )
        return watchlist

    def get_watchlist(self, watchlist_id: str) -> Watchlist | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM watchlists WHERE id = ?", (watchlist_id,)
        )
        return model_from_json(Watchlist, row["payload_json"]) if row else None

    def get_watchlist_by_name(self, name: str) -> Watchlist | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM watchlists WHERE name = ?", (name,)
        )
        return model_from_json(Watchlist, row["payload_json"]) if row else None

    def list_watchlists(
        self, *, enabled_only: bool = False, limit: int = 50
    ) -> list[Watchlist]:
        if enabled_only:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM watchlists
                WHERE enabled = 1
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM watchlists
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(Watchlist, row["payload_json"]) for row in rows]

    def save_watchlist_item(self, item: WatchlistItem) -> WatchlistItem:
        if not item.id:
            item.id = _new_id("watch_item")
        self.store.execute(
            """
            INSERT INTO watchlist_items (
                id, watchlist_id, item_type, symbol, thesis_id, setup_type,
                enabled, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                item_type=excluded.item_type,
                symbol=excluded.symbol,
                thesis_id=excluded.thesis_id,
                setup_type=excluded.setup_type,
                enabled=excluded.enabled,
                payload_json=excluded.payload_json
            """,
            (
                item.id,
                item.watchlist_id,
                item.item_type.value,
                item.symbol,
                item.thesis_id,
                item.setup_type,
                1 if item.enabled else 0,
                _iso(item.created_at),
                model_to_json(item),
            ),
        )
        return item

    def get_watchlist_item(self, item_id: str) -> WatchlistItem | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM watchlist_items WHERE id = ?", (item_id,)
        )
        return model_from_json(WatchlistItem, row["payload_json"]) if row else None

    def list_watchlist_items(
        self,
        *,
        watchlist_id: str | None = None,
        enabled_only: bool = False,
        limit: int = 100,
    ) -> list[WatchlistItem]:
        conditions = []
        params: list[object] = []
        if watchlist_id:
            conditions.append("watchlist_id = ?")
            params.append(watchlist_id)
        if enabled_only:
            conditions.append("enabled = 1")
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM watchlist_items
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [model_from_json(WatchlistItem, row["payload_json"]) for row in rows]

    def disable_watchlist_item(self, item_id: str) -> WatchlistItem | None:
        item = self.get_watchlist_item(item_id)
        if not item:
            return None
        item.enabled = False
        return self.save_watchlist_item(item)

    def save_alert(self, alert: Alert) -> Alert:
        if not alert.id:
            alert.id = _new_id("alert")
        trigger_key = alert.trigger_key or alert.payload.get("trigger_key")
        if trigger_key is not None:
            alert.trigger_key = str(trigger_key)
            alert.payload.setdefault("trigger_key", alert.trigger_key)
        self.store.execute(
            """
            INSERT INTO alerts (
                id, alert_type, symbol, thesis_id, watchlist_item_id, trigger_key,
                created_at, read_at, message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                trigger_key=excluded.trigger_key,
                read_at=excluded.read_at,
                message=excluded.message,
                payload_json=excluded.payload_json
            """,
            (
                alert.id,
                alert.alert_type.value,
                alert.symbol,
                alert.thesis_id,
                alert.watchlist_item_id,
                alert.trigger_key,
                _iso(alert.created_at),
                _iso(alert.read_at),
                alert.message,
                model_to_json(alert),
            ),
        )
        return alert

    def list_alerts(
        self,
        *,
        symbol: str | None = None,
        thesis_id: str | None = None,
        unread_only: bool = False,
        limit: int = 100,
    ) -> list[Alert]:
        conditions = []
        params: list[object] = []
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        if thesis_id:
            conditions.append("thesis_id = ?")
            params.append(thesis_id)
        if unread_only:
            conditions.append("read_at IS NULL")
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT trigger_key, payload_json FROM alerts
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [self._alert_from_row(row) for row in rows]

    def has_alert(
        self,
        *,
        alert_type: str,
        thesis_id: str | None,
        watchlist_item_id: str | None,
        trigger_key: str,
    ) -> bool:
        row = self.store.fetchone(
            """
            SELECT 1 FROM alerts
            WHERE alert_type = ?
              AND trigger_key = ?
              AND COALESCE(thesis_id, '') = COALESCE(?, '')
              AND COALESCE(watchlist_item_id, '') = COALESCE(?, '')
            LIMIT 1
            """,
            (alert_type, trigger_key, thesis_id, watchlist_item_id),
        )
        return row is not None

    def mark_alert_read(
        self, alert_id: str, read_at: datetime | None = None
    ) -> Alert | None:
        row = self.store.fetchone(
            "SELECT trigger_key, payload_json FROM alerts WHERE id = ?", (alert_id,)
        )
        if not row:
            return None
        alert = self._alert_from_row(row)
        alert.read_at = read_at or datetime.now(timezone.utc)
        return self.save_alert(alert)

    @staticmethod
    def _alert_from_row(row) -> Alert:
        alert = model_from_json(Alert, row["payload_json"])
        if not alert.trigger_key:
            trigger_key = row["trigger_key"] if "trigger_key" in row.keys() else None
            if trigger_key:
                alert.trigger_key = trigger_key
        return alert

    def save_market_brief(self, brief: MarketBrief) -> MarketBrief:
        if not brief.id:
            brief.id = _new_id("brief")
        self.store.execute(
            """
            INSERT INTO market_briefs (
                id, brief_date, watchlist_name, title, created_at,
                previous_brief_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                brief_date=excluded.brief_date,
                watchlist_name=excluded.watchlist_name,
                title=excluded.title,
                previous_brief_id=excluded.previous_brief_id,
                payload_json=excluded.payload_json
            """,
            (
                brief.id,
                brief.brief_date.isoformat(),
                brief.watchlist_name,
                brief.title,
                _iso(brief.created_at),
                brief.previous_brief_id,
                model_to_json(brief),
            ),
        )
        return brief

    def get_market_brief(self, brief_id: str) -> MarketBrief | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM market_briefs WHERE id = ?", (brief_id,)
        )
        return model_from_json(MarketBrief, row["payload_json"]) if row else None

    def get_latest_market_brief(
        self,
        *,
        watchlist_name: str | None = None,
        before_date: str | None = None,
    ) -> MarketBrief | None:
        conditions = []
        params: list[object] = []
        if watchlist_name:
            conditions.append("watchlist_name = ?")
            params.append(watchlist_name)
        if before_date:
            conditions.append("brief_date < ?")
            params.append(before_date)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        row = self.store.fetchone(
            f"""
            SELECT payload_json FROM market_briefs
            {where_clause}
            ORDER BY brief_date DESC, created_at DESC
            LIMIT 1
            """,
            tuple(params),
        )
        return model_from_json(MarketBrief, row["payload_json"]) if row else None

    def list_market_briefs(
        self,
        *,
        watchlist_name: str | None = None,
        limit: int = 20,
    ) -> list[MarketBrief]:
        if watchlist_name:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM market_briefs
                WHERE watchlist_name = ?
                ORDER BY brief_date DESC, created_at DESC
                LIMIT ?
                """,
                (watchlist_name, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM market_briefs
                ORDER BY brief_date DESC, created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(MarketBrief, row["payload_json"]) for row in rows]

    def save_thesis_evaluation(self, evaluation: ThesisEvaluation) -> ThesisEvaluation:
        if not evaluation.id:
            evaluation.id = _new_id("evaluation")
        self.store.execute(
            """
            INSERT INTO thesis_evaluations (
                id, thesis_id, symbol, evaluated_at, evaluation_start,
                evaluation_end, result, invalidated, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                result=excluded.result,
                invalidated=excluded.invalidated,
                payload_json=excluded.payload_json
            """,
            (
                evaluation.id,
                evaluation.thesis_id,
                evaluation.symbol,
                _iso(evaluation.evaluated_at),
                evaluation.evaluation_start.isoformat(),
                evaluation.evaluation_end.isoformat(),
                evaluation.result.value,
                1 if evaluation.invalidated else 0,
                model_to_json(evaluation),
            ),
        )
        return evaluation

    def get_thesis_evaluation(self, evaluation_id: str) -> ThesisEvaluation | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM thesis_evaluations WHERE id = ?", (evaluation_id,)
        )
        return model_from_json(ThesisEvaluation, row["payload_json"]) if row else None

    def list_thesis_evaluations(
        self,
        *,
        thesis_id: str | None = None,
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[ThesisEvaluation]:
        conditions = []
        params: list[object] = []
        if thesis_id:
            conditions.append("thesis_id = ?")
            params.append(thesis_id)
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM thesis_evaluations
            {where_clause}
            ORDER BY evaluated_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [model_from_json(ThesisEvaluation, row["payload_json"]) for row in rows]

    def save_user_decision(self, decision: UserDecision, *, _conn=None) -> UserDecision:
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
            ), _conn=_conn,
        )
        return decision

    def save_outcome_review(self, review: OutcomeReview, *, _conn=None) -> OutcomeReview:
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
            ), _conn=_conn,
        )
        return review

    def get_outcome_review(self, review_id: str) -> OutcomeReview | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM outcome_reviews WHERE id = ?", (review_id,)
        )
        return model_from_json(OutcomeReview, row["payload_json"]) if row else None

    def list_outcome_reviews(
        self,
        *,
        thesis_id: str | None = None,
        limit: int = 100,
    ) -> list[OutcomeReview]:
        if thesis_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM outcome_reviews
                WHERE thesis_id = ?
                ORDER BY reviewed_at DESC
                LIMIT ?
                """,
                (thesis_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM outcome_reviews
                ORDER BY reviewed_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(OutcomeReview, row["payload_json"]) for row in rows]

    def add_run_event(
        self,
        research_run_id: str,
        event_type: str,
        message: str,
        payload: dict | None = None,
        *,
        thesis_id: str | None = None,
        _conn=None,
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
            ), _conn=_conn,
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

    # ------------------------------------------------------------------
    # Phase 4 (tail): Reliability snapshots
    # ------------------------------------------------------------------

    def save_reliability_snapshot(self, snapshot, *, _conn=None) -> Any:
        """Save a reliability snapshot as a payload_json row."""
        if not snapshot.id:
            snapshot.id = _new_id("rel_snap")
        self.store.execute(
            """
            INSERT INTO reliability_snapshots (
                id, symbol, snapshot_date, rolling_window_days,
                overall_hit_rate, overall_sample_size, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                overall_hit_rate=excluded.overall_hit_rate,
                overall_sample_size=excluded.overall_sample_size,
                payload_json=excluded.payload_json
            """,
            (
                snapshot.id,
                snapshot.symbol,
                _iso(snapshot.snapshot_date),
                snapshot.rolling_window_days,
                snapshot.overall_hit_rate,
                snapshot.overall_sample_size,
                model_to_json(snapshot),
            ),
            _conn=_conn,
        )
        return snapshot

    def get_reliability_snapshot(self, snapshot_id: str) -> Any | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM reliability_snapshots WHERE id = ?",
            (snapshot_id,),
        )
        if not row:
            return None
        from tradingagents.domain.snapshot import ReliabilitySnapshot

        return model_from_json(ReliabilitySnapshot, row["payload_json"])

    def list_reliability_snapshots(
        self,
        *,
        symbol: str | None = None,
        rolling_window_days: int | None = None,
        limit: int = 20,
    ) -> list:
        from tradingagents.domain.snapshot import ReliabilitySnapshot

        conditions = []
        params: list[object] = []
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        if rolling_window_days is not None:
            conditions.append("rolling_window_days = ?")
            params.append(rolling_window_days)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM reliability_snapshots
            {where_clause}
            ORDER BY snapshot_date DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [
            model_from_json(ReliabilitySnapshot, row["payload_json"]) for row in rows
        ]
