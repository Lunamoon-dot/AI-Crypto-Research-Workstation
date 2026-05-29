"""Monitoring repository methods for thesis pulse artifacts."""

from __future__ import annotations

from .base import (
    RepositoryMixinBase,
    ThesisMonitorPlan,
    ThesisPulse,
    ThesisPulseMemo,
    _iso,
    _new_id,
    dumps_payload,
    model_from_json,
    model_to_json,
)


class MonitoringRepositoryMixin(RepositoryMixinBase):
    def save_thesis_monitor_plan(
        self, plan: ThesisMonitorPlan, *, _conn=None
    ) -> ThesisMonitorPlan:
        if not plan.id:
            plan.id = _new_id("monitor_plan")
        self.store.execute(
            """
            INSERT INTO thesis_monitor_plans (
                id, workspace_id, thesis_id, baseline_run_id, symbol, market_type,
                status, created_at, updated_at, baseline_price,
                baseline_price_source, baseline_observed_at, entry_low, entry_high,
                invalidation_level, invalidation_direction, targets_json,
                scenario_triggers_json, missing_fields_json, price_interval_minutes,
                signal_interval_minutes, memo_interval_minutes, watch_distance_pct,
                review_distance_pct, consecutive_review_to_rerun,
                consecutive_invalidation_to_rerun, run_memo_on_review,
                run_memo_on_rerun_full, skip_memo_if_no_new_pulses,
                enabled_signal_factors_json, scheduler_enabled, latest_pulse_id,
                latest_memo_id, latest_status, latest_price,
                latest_trigger_reasons_json, last_pulse_at, next_pulse_due_at,
                last_memo_at, next_memo_due_at, payload_json
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(workspace_id, thesis_id) DO UPDATE SET
                baseline_run_id=excluded.baseline_run_id,
                symbol=excluded.symbol,
                market_type=excluded.market_type,
                status=excluded.status,
                updated_at=excluded.updated_at,
                baseline_price=excluded.baseline_price,
                baseline_price_source=excluded.baseline_price_source,
                baseline_observed_at=excluded.baseline_observed_at,
                entry_low=excluded.entry_low,
                entry_high=excluded.entry_high,
                invalidation_level=excluded.invalidation_level,
                invalidation_direction=excluded.invalidation_direction,
                targets_json=excluded.targets_json,
                scenario_triggers_json=excluded.scenario_triggers_json,
                missing_fields_json=excluded.missing_fields_json,
                price_interval_minutes=excluded.price_interval_minutes,
                signal_interval_minutes=excluded.signal_interval_minutes,
                memo_interval_minutes=excluded.memo_interval_minutes,
                watch_distance_pct=excluded.watch_distance_pct,
                review_distance_pct=excluded.review_distance_pct,
                consecutive_review_to_rerun=excluded.consecutive_review_to_rerun,
                consecutive_invalidation_to_rerun=excluded.consecutive_invalidation_to_rerun,
                run_memo_on_review=excluded.run_memo_on_review,
                run_memo_on_rerun_full=excluded.run_memo_on_rerun_full,
                skip_memo_if_no_new_pulses=excluded.skip_memo_if_no_new_pulses,
                enabled_signal_factors_json=excluded.enabled_signal_factors_json,
                scheduler_enabled=excluded.scheduler_enabled,
                latest_pulse_id=excluded.latest_pulse_id,
                latest_memo_id=excluded.latest_memo_id,
                latest_status=excluded.latest_status,
                latest_price=excluded.latest_price,
                latest_trigger_reasons_json=excluded.latest_trigger_reasons_json,
                last_pulse_at=excluded.last_pulse_at,
                next_pulse_due_at=excluded.next_pulse_due_at,
                last_memo_at=excluded.last_memo_at,
                next_memo_due_at=excluded.next_memo_due_at,
                payload_json=excluded.payload_json
            """,
            (
                plan.id,
                plan.workspace_id,
                plan.thesis_id,
                plan.baseline_run_id,
                plan.symbol,
                plan.market_type,
                plan.status.value,
                _iso(plan.created_at),
                _iso(plan.updated_at),
                plan.baseline_price,
                plan.baseline_price_source,
                _iso(plan.baseline_observed_at),
                plan.entry_low,
                plan.entry_high,
                plan.invalidation_level,
                plan.invalidation_direction.value
                if plan.invalidation_direction
                else None,
                dumps_payload(
                    [target.model_dump(mode="json") for target in plan.targets]
                ),
                dumps_payload(plan.scenario_triggers),
                dumps_payload(plan.missing_fields),
                plan.price_interval_minutes,
                plan.signal_interval_minutes,
                plan.memo_interval_minutes,
                plan.watch_distance_pct,
                plan.review_distance_pct,
                plan.consecutive_review_to_rerun,
                plan.consecutive_invalidation_to_rerun,
                int(plan.run_memo_on_review),
                int(plan.run_memo_on_rerun_full),
                int(plan.skip_memo_if_no_new_pulses),
                dumps_payload(plan.enabled_signal_factors),
                int(plan.scheduler_enabled),
                plan.latest_pulse_id,
                plan.latest_memo_id,
                plan.latest_status.value if plan.latest_status else None,
                plan.latest_price,
                dumps_payload(plan.latest_trigger_reasons),
                _iso(plan.last_pulse_at),
                _iso(plan.next_pulse_due_at),
                _iso(plan.last_memo_at),
                _iso(plan.next_memo_due_at),
                model_to_json(plan),
            ),
            _conn=_conn,
        )
        return (
            self.get_thesis_monitor_plan(
                plan.thesis_id,
                workspace_id=plan.workspace_id,
            )
            or plan
        )

    def get_thesis_monitor_plan(
        self, thesis_id: str, *, workspace_id: str = "local"
    ) -> ThesisMonitorPlan | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM thesis_monitor_plans
            WHERE thesis_id = ? AND workspace_id = ?
            """,
            (thesis_id, workspace_id),
        )
        return model_from_json(ThesisMonitorPlan, row["payload_json"]) if row else None

    def get_thesis_monitor_plan_by_id(
        self, plan_id: str, *, workspace_id: str = "local"
    ) -> ThesisMonitorPlan | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM thesis_monitor_plans
            WHERE id = ? AND workspace_id = ?
            """,
            (plan_id, workspace_id),
        )
        return model_from_json(ThesisMonitorPlan, row["payload_json"]) if row else None

    def save_thesis_pulse(self, pulse: ThesisPulse, *, _conn=None) -> ThesisPulse:
        if not pulse.id:
            pulse.id = _new_id("pulse")
        self.store.execute(
            """
            INSERT INTO thesis_pulses (
                id, workspace_id, thesis_id, monitor_plan_id, baseline_run_id,
                symbol, market_type, pulse_type, bucket_start, observed_at,
                current_price, baseline_price, price_change_pct,
                distance_to_entry_pct, distance_to_invalidation_pct,
                nearest_target, distance_to_nearest_target_pct, signal_bias,
                signal_confidence, signal_delta, scenario_status, score, status,
                suggested_action, trigger_reasons_json, hard_triggers_json,
                missing_data_json, payload_json
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(thesis_id, bucket_start, pulse_type) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                monitor_plan_id=excluded.monitor_plan_id,
                baseline_run_id=excluded.baseline_run_id,
                symbol=excluded.symbol,
                market_type=excluded.market_type,
                observed_at=excluded.observed_at,
                current_price=excluded.current_price,
                baseline_price=excluded.baseline_price,
                price_change_pct=excluded.price_change_pct,
                distance_to_entry_pct=excluded.distance_to_entry_pct,
                distance_to_invalidation_pct=excluded.distance_to_invalidation_pct,
                nearest_target=excluded.nearest_target,
                distance_to_nearest_target_pct=excluded.distance_to_nearest_target_pct,
                signal_bias=excluded.signal_bias,
                signal_confidence=excluded.signal_confidence,
                signal_delta=excluded.signal_delta,
                scenario_status=excluded.scenario_status,
                score=excluded.score,
                status=excluded.status,
                suggested_action=excluded.suggested_action,
                trigger_reasons_json=excluded.trigger_reasons_json,
                hard_triggers_json=excluded.hard_triggers_json,
                missing_data_json=excluded.missing_data_json,
                payload_json=excluded.payload_json
            """,
            (
                pulse.id,
                pulse.workspace_id,
                pulse.thesis_id,
                pulse.monitor_plan_id,
                pulse.baseline_run_id,
                pulse.symbol,
                pulse.market_type,
                pulse.pulse_type,
                _iso(pulse.bucket_start),
                _iso(pulse.observed_at),
                pulse.current_price,
                pulse.baseline_price,
                pulse.price_change_pct,
                pulse.distance_to_entry_pct,
                pulse.distance_to_invalidation_pct,
                pulse.nearest_target,
                pulse.distance_to_nearest_target_pct,
                pulse.signal_bias,
                pulse.signal_confidence,
                pulse.signal_delta,
                pulse.scenario_status,
                pulse.score,
                pulse.status.value,
                pulse.suggested_action.value,
                dumps_payload(pulse.trigger_reasons),
                dumps_payload(pulse.hard_triggers),
                dumps_payload(pulse.missing_data),
                model_to_json(pulse),
            ),
            _conn=_conn,
        )
        return (
            self.get_thesis_pulse_by_bucket(
                pulse.thesis_id,
                pulse.bucket_start.isoformat(),
                pulse_type=pulse.pulse_type,
                workspace_id=pulse.workspace_id,
            )
            or pulse
        )

    def get_thesis_pulse_by_bucket(
        self,
        thesis_id: str,
        bucket_start: str,
        *,
        pulse_type: str = "manual",
        workspace_id: str = "local",
    ) -> ThesisPulse | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM thesis_pulses
            WHERE thesis_id = ?
              AND bucket_start = ?
              AND pulse_type = ?
              AND workspace_id = ?
            """,
            (thesis_id, bucket_start, pulse_type, workspace_id),
        )
        return model_from_json(ThesisPulse, row["payload_json"]) if row else None

    def list_thesis_pulses(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        limit: int = 200,
    ) -> list[ThesisPulse]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM thesis_pulses
            WHERE thesis_id = ? AND workspace_id = ?
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
            """,
            (thesis_id, workspace_id, limit),
        )
        return [model_from_json(ThesisPulse, row["payload_json"]) for row in rows]

    def list_thesis_pulses_in_window(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        window_start: str,
        window_end: str,
        limit: int = 48,
    ) -> list[ThesisPulse]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM thesis_pulses
            WHERE thesis_id = ?
              AND workspace_id = ?
              AND observed_at >= ?
              AND observed_at <= ?
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
            """,
            (thesis_id, workspace_id, window_start, window_end, limit),
        )
        return [model_from_json(ThesisPulse, row["payload_json"]) for row in rows]

    def save_thesis_pulse_memo(
        self, memo: ThesisPulseMemo, *, _conn=None
    ) -> ThesisPulseMemo:
        if not memo.id:
            memo.id = _new_id("pulse_memo")
        self.store.execute(
            """
            INSERT INTO thesis_pulse_memos (
                id, workspace_id, thesis_id, monitor_plan_id, baseline_run_id,
                memo_type, window_start, window_end, created_at, status, summary,
                what_changed_json, why_it_matters_json, what_to_watch_next_json,
                recommended_action, rerun_full_recommended, confidence,
                referenced_pulse_ids_json, prompt_version, provider, model,
                payload_json
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON CONFLICT(workspace_id, thesis_id, window_start, window_end, memo_type)
            DO UPDATE SET
                monitor_plan_id=excluded.monitor_plan_id,
                baseline_run_id=excluded.baseline_run_id,
                created_at=excluded.created_at,
                status=excluded.status,
                summary=excluded.summary,
                what_changed_json=excluded.what_changed_json,
                why_it_matters_json=excluded.why_it_matters_json,
                what_to_watch_next_json=excluded.what_to_watch_next_json,
                recommended_action=excluded.recommended_action,
                rerun_full_recommended=excluded.rerun_full_recommended,
                confidence=excluded.confidence,
                referenced_pulse_ids_json=excluded.referenced_pulse_ids_json,
                prompt_version=excluded.prompt_version,
                provider=excluded.provider,
                model=excluded.model,
                payload_json=excluded.payload_json
            """,
            (
                memo.id,
                memo.workspace_id,
                memo.thesis_id,
                memo.monitor_plan_id,
                memo.baseline_run_id,
                memo.memo_type,
                _iso(memo.window_start),
                _iso(memo.window_end),
                _iso(memo.created_at),
                memo.status.value,
                memo.summary,
                dumps_payload(memo.what_changed),
                dumps_payload(memo.why_it_matters),
                dumps_payload(memo.what_to_watch_next),
                memo.recommended_action.value,
                int(memo.rerun_full_recommended),
                memo.confidence,
                dumps_payload(memo.referenced_pulse_ids),
                memo.prompt_version,
                memo.provider,
                memo.model,
                model_to_json(memo),
            ),
            _conn=_conn,
        )
        return (
            self.get_thesis_pulse_memo_by_window(
                memo.thesis_id,
                memo.window_start.isoformat(),
                memo.window_end.isoformat(),
                memo_type=memo.memo_type,
                workspace_id=memo.workspace_id,
            )
            or memo
        )

    def get_thesis_pulse_memo_by_window(
        self,
        thesis_id: str,
        window_start: str,
        window_end: str,
        *,
        memo_type: str = "manual",
        workspace_id: str = "local",
    ) -> ThesisPulseMemo | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM thesis_pulse_memos
            WHERE thesis_id = ?
              AND workspace_id = ?
              AND window_start = ?
              AND window_end = ?
              AND memo_type = ?
            """,
            (thesis_id, workspace_id, window_start, window_end, memo_type),
        )
        return model_from_json(ThesisPulseMemo, row["payload_json"]) if row else None

    def list_thesis_pulse_memos(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        limit: int = 50,
    ) -> list[ThesisPulseMemo]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM thesis_pulse_memos
            WHERE thesis_id = ? AND workspace_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (thesis_id, workspace_id, limit),
        )
        return [model_from_json(ThesisPulseMemo, row["payload_json"]) for row in rows]

    def update_monitor_plan_latest_state(
        self, plan: ThesisMonitorPlan, pulse: ThesisPulse, *, _conn=None
    ) -> ThesisMonitorPlan:
        plan.latest_pulse_id = pulse.id
        plan.latest_status = pulse.status
        plan.latest_price = pulse.current_price
        plan.latest_trigger_reasons = list(pulse.trigger_reasons)
        plan.last_pulse_at = pulse.observed_at
        return self.save_thesis_monitor_plan(plan, _conn=_conn)

    def update_monitor_plan_latest_memo_state(
        self, plan: ThesisMonitorPlan, memo: ThesisPulseMemo, *, _conn=None
    ) -> ThesisMonitorPlan:
        plan.latest_memo_id = memo.id
        plan.last_memo_at = memo.created_at
        return self.save_thesis_monitor_plan(plan, _conn=_conn)
