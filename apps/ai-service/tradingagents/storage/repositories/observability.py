"""ObservabilityRepository aggregate for the SQLite journal."""

from __future__ import annotations

from .base import *


class ObservabilityRepositoryMixin:
    def add_run_event(
        self,
        research_run_id: str,
        event_type: str,
        message: str,
        payload: dict | None = None,
        *,
        thesis_id: str | None = None,
        workspace_id: str | None = None,
        _conn=None,
    ) -> TimelineEvent:
        workspace = (
            workspace_id or self._workspace_for_run(research_run_id, _conn=_conn) or "local"
        )
        event = TimelineEvent(
            id=_new_id("event"),
            workspace_id=workspace,
            research_run_id=research_run_id,
            thesis_id=thesis_id,
            event_type=event_type,
            message=message,
            payload=payload or {},
        )
        self.store.execute(
            """
            INSERT INTO run_events (
                id, workspace_id, research_run_id, thesis_id, event_type,
                created_at, message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.id,
                event.workspace_id,
                event.research_run_id,
                event.thesis_id,
                event.event_type,
                _iso(event.created_at),
                event.message,
                dumps_payload(event.payload),
            ),
            _conn=_conn,
        )
        return event

    def list_timeline_events(
        self,
        *,
        research_run_id: str | None = None,
        thesis_id: str | None = None,
        limit: int = 200,
        workspace_id: str | None = None,
    ) -> list[TimelineEvent]:
        if thesis_id:
            conditions = ["thesis_id = ?"]
            params: list[object] = [thesis_id]
            if workspace_id:
                conditions.append("workspace_id = ?")
                params.append(workspace_id)
            rows = self.store.fetchall(
                f"""
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json, workspace_id
                FROM run_events
                WHERE {' AND '.join(conditions)}
                ORDER BY created_at
                LIMIT ?
                """,
                (*params, limit),
            )
        elif research_run_id:
            conditions = ["research_run_id = ?"]
            params = [research_run_id]
            if workspace_id:
                conditions.append("workspace_id = ?")
                params.append(workspace_id)
            rows = self.store.fetchall(
                f"""
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json, workspace_id
                FROM run_events
                WHERE {' AND '.join(conditions)}
                ORDER BY created_at
                LIMIT ?
                """,
                (*params, limit),
            )
        else:
            where_clause = "WHERE workspace_id = ?" if workspace_id else ""
            params = [workspace_id] if workspace_id else []
            rows = self.store.fetchall(
                f"""
                SELECT id, research_run_id, thesis_id, event_type, created_at,
                       message, payload_json, workspace_id
                FROM run_events
                {where_clause}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (*params, limit),
            )
        return [self._timeline_event_from_row(row) for row in rows]

    @staticmethod
    def _timeline_event_from_row(row) -> TimelineEvent:
        return TimelineEvent(
            id=row["id"],
            workspace_id=row["workspace_id"] if "workspace_id" in row.keys() else "local",
            research_run_id=row["research_run_id"],
            thesis_id=row["thesis_id"],
            event_type=row["event_type"],
            created_at=datetime.fromisoformat(row["created_at"]),
            message=row["message"],
            payload=json.loads(row["payload_json"] or "{}"),
        )

    def _workspace_for_run(self, research_run_id: str, *, _conn=None) -> str | None:
        sql = "SELECT workspace_id FROM research_runs WHERE id = ?"
        if _conn is not None:
            row = _conn.execute(sql, (research_run_id,)).fetchone()
        else:
            row = self.store.fetchone(sql, (research_run_id,))
        if not row:
            return None
        return row["workspace_id"] or "local"

    def save_provider_health(
        self, record: ProviderHealthRecord, *, _conn=None
    ) -> ProviderHealthRecord:
        if not record.id:
            record.id = _new_id("provider_health")
        self.store.execute(
            """
            INSERT INTO provider_health (
                id, provider, component, status, checked_at, latency_ms,
                error_type, error_message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.id,
                record.provider,
                record.component,
                record.status,
                _iso(record.checked_at),
                record.latency_ms,
                record.error_type,
                record.error_message,
                model_to_json(record),
            ),
            _conn=_conn,
        )
        return record

    def list_provider_health(
        self,
        *,
        provider: str | None = None,
        limit: int = 100,
    ) -> list[ProviderHealthRecord]:
        if provider:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM provider_health
                WHERE provider = ?
                ORDER BY checked_at DESC
                LIMIT ?
                """,
                (provider, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM provider_health
                ORDER BY checked_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [
            model_from_json(ProviderHealthRecord, row["payload_json"]) for row in rows
        ]

    def save_llm_call(self, record: LLMCallRecord, *, _conn=None) -> LLMCallRecord:
        if not record.id:
            record.id = _new_id("llm_call")
        self.store.execute(
            """
            INSERT INTO llm_calls (
                id, research_run_id, thesis_id, provider, model, stage, agent,
                input_tokens, output_tokens, latency_ms, status, error_type,
                error_message, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.id,
                record.research_run_id,
                record.thesis_id,
                record.provider,
                record.model,
                record.stage,
                record.agent,
                record.input_tokens,
                record.output_tokens,
                record.latency_ms,
                record.status,
                record.error_type,
                record.error_message,
                _iso(record.created_at),
                model_to_json(record),
            ),
            _conn=_conn,
        )
        return record

    def list_llm_calls(
        self,
        *,
        research_run_id: str | None = None,
        limit: int = 100,
    ) -> list[LLMCallRecord]:
        if research_run_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM llm_calls
                WHERE research_run_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (research_run_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM llm_calls
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(LLMCallRecord, row["payload_json"]) for row in rows]

    def save_data_freshness_check(
        self, record: DataFreshnessCheck, *, _conn=None
    ) -> DataFreshnessCheck:
        if not record.id:
            record.id = _new_id("freshness")
        self.store.execute(
            """
            INSERT INTO data_freshness_checks (
                id, research_run_id, symbol, source, source_timestamp,
                observed_timestamp, age_seconds, threshold_seconds, status,
                payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.id,
                record.research_run_id,
                record.symbol,
                record.source,
                _iso(record.source_timestamp),
                _iso(record.observed_timestamp),
                record.age_seconds,
                record.threshold_seconds,
                record.status,
                model_to_json(record),
            ),
            _conn=_conn,
        )
        return record

    def list_data_freshness_checks(
        self,
        *,
        research_run_id: str | None = None,
        source: str | None = None,
        limit: int = 100,
    ) -> list[DataFreshnessCheck]:
        conditions = []
        params: list[object] = []
        if research_run_id:
            conditions.append("research_run_id = ?")
            params.append(research_run_id)
        if source:
            conditions.append("source = ?")
            params.append(source)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM data_freshness_checks
            {where_clause}
            ORDER BY observed_timestamp DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [
            model_from_json(DataFreshnessCheck, row["payload_json"]) for row in rows
        ]

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
