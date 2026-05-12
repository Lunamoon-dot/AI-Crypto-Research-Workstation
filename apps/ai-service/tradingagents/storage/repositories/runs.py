"""RunsRepository aggregate for the SQLite journal."""

from __future__ import annotations

from datetime import datetime, timezone

from .base import (
    ResearchRun,
    ResearchRunStatus,
    RepositoryMixinBase,
    _iso,
    _new_id,
    dumps_payload,
    model_from_json,
    model_to_json,
)


class RunsRepositoryMixin(RepositoryMixinBase):
    def save_research_run(self, run: ResearchRun, *, _conn=None) -> ResearchRun:
        if not run.id:
            run.id = _new_id("run")
        self.store.execute(
            """
            INSERT INTO research_runs (
                id, workspace_id, symbol, asset_class, timeframe, status, started_at,
                completed_at, deep_think_model, quick_think_model, llm_provider,
                config_hash, market_snapshot_id, signal_snapshot_id, debate_id,
                thesis_id, decision_id, user_decision_id, outcome_review_id,
                degradation_reasons_json, missing_core_data_json,
                missing_optional_data_json,
                payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                symbol=excluded.symbol,
                asset_class=excluded.asset_class,
                timeframe=excluded.timeframe,
                status=excluded.status,
                completed_at=excluded.completed_at,
                deep_think_model=excluded.deep_think_model,
                quick_think_model=excluded.quick_think_model,
                llm_provider=excluded.llm_provider,
                config_hash=excluded.config_hash,
                market_snapshot_id=excluded.market_snapshot_id,
                signal_snapshot_id=excluded.signal_snapshot_id,
                debate_id=excluded.debate_id,
                thesis_id=excluded.thesis_id,
                decision_id=excluded.decision_id,
                user_decision_id=excluded.user_decision_id,
                outcome_review_id=excluded.outcome_review_id,
                degradation_reasons_json=excluded.degradation_reasons_json,
                missing_core_data_json=excluded.missing_core_data_json,
                missing_optional_data_json=excluded.missing_optional_data_json,
                payload_json=excluded.payload_json
            """,
            (
                run.id,
                run.workspace_id,
                run.symbol,
                run.asset_class,
                run.timeframe,
                run.status.value,
                _iso(run.started_at),
                _iso(run.completed_at),
                run.deep_think_model,
                run.quick_think_model,
                run.llm_provider,
                run.config_hash,
                run.market_snapshot_id,
                run.signal_snapshot_id,
                run.debate_id,
                run.thesis_id,
                run.decision_id,
                run.user_decision_id,
                run.outcome_review_id,
                dumps_payload(run.degradation_reasons),
                dumps_payload(run.missing_core_data),
                dumps_payload(run.missing_optional_data),
                model_to_json(run),
            ),
            _conn=_conn,
        )
        return run

    def complete_research_run(self, run: ResearchRun, *, _conn=None) -> ResearchRun:
        if run.status == ResearchRunStatus.FAILED or run.missing_core_data:
            run.status = ResearchRunStatus.FAILED
        elif (
            run.status == ResearchRunStatus.COMPLETED_DEGRADED
            or run.degradation_reasons
            or run.missing_optional_data
        ):
            run.status = ResearchRunStatus.COMPLETED_DEGRADED
        else:
            run.status = ResearchRunStatus.COMPLETED
        run.completed_at = datetime.now(timezone.utc)
        return self.save_research_run(run, _conn=_conn)

    def get_research_run(
        self, run_id: str, *, workspace_id: str | None = None
    ) -> ResearchRun | None:
        if workspace_id:
            row = self.store.fetchone(
                "SELECT payload_json FROM research_runs WHERE id = ? AND workspace_id = ?",
                (run_id, workspace_id),
            )
        else:
            row = self.store.fetchone(
                "SELECT payload_json FROM research_runs WHERE id = ?", (run_id,)
            )
        return model_from_json(ResearchRun, row["payload_json"]) if row else None

    def list_research_runs(
        self, limit: int = 20, *, workspace_id: str = "local"
    ) -> list[ResearchRun]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM research_runs
            WHERE workspace_id = ?
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (workspace_id, limit),
        )
        return [model_from_json(ResearchRun, row["payload_json"]) for row in rows]
