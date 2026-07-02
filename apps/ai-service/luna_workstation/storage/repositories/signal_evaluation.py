"""Signal evaluation repository mixin."""

from __future__ import annotations

from typing import Any

from luna_workstation.signals.evaluation.models import (
    SignalCalibratorVersion,
    SignalEvaluationReport,
    SignalModelAlert,
    SignalModelMonitoringSnapshot,
    SignalModelPromotion,
    SignalModelRollback,
    SignalObservation,
    SignalOutcomeLabel,
    SignalWeightVersion,
)

from .base import RepositoryMixinBase, _iso, json, model_to_json


class SignalEvaluationRepositoryMixin(RepositoryMixinBase):
    def save_signal_observations(
        self,
        observations: list[SignalObservation],
        *,
        _conn=None,
    ) -> list[SignalObservation]:
        if not observations:
            return []
        params = [
            (
                item.id,
                item.workspace_id,
                item.research_run_id,
                item.signal_snapshot_id,
                item.signal_id,
                item.symbol,
                item.timeframe,
                _iso(item.observed_at),
                _iso(item.source_timestamp),
                item.observation_kind,
                item.factor_name,
                item.factor_family,
                item.direction,
                item.directional_edge,
                item.heuristic_strength,
                item.detector_confidence,
                item.data_quality,
                item.availability,
                item.raw_value,
                int(item.threshold_breached),
                item.market_regime,
                item.volatility_regime,
                item.provider,
                item.source_snapshot_hash,
                item.code_sha,
                item.signal_weight_version,
                item.signal_threshold_version,
                item.detector_version,
                json.dumps(item.evidence_json, ensure_ascii=True),
                json.dumps(item.metadata_json, ensure_ascii=True),
                model_to_json(item),
                _iso(item.created_at),
            )
            for item in observations
        ]

        def _execute(conn):
            conn.executemany(
                """
                INSERT INTO signal_observations (
                    id, workspace_id, research_run_id, signal_snapshot_id,
                    signal_id, symbol, timeframe, observed_at, source_timestamp,
                    observation_kind, factor_name, factor_family, direction,
                    directional_edge, heuristic_strength, detector_confidence,
                    data_quality, availability, raw_value, threshold_breached,
                    market_regime, volatility_regime, provider, source_snapshot_hash,
                    code_sha, signal_weight_version, signal_threshold_version,
                    detector_version, evidence_json, metadata_json, payload_json,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO NOTHING
                """,
                params,
            )

        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return observations

    def list_signal_observations(
        self,
        *,
        workspace_id: str = "local",
        symbol: str | None = None,
        factor_name: str | None = None,
        signal_snapshot_id: str | None = None,
        limit: int = 100,
    ) -> list[SignalObservation]:
        where = ["workspace_id = ?"]
        params: list[Any] = [workspace_id]
        if symbol:
            where.append("symbol = ?")
            params.append(symbol)
        if factor_name:
            where.append("factor_name = ?")
            params.append(factor_name)
        if signal_snapshot_id:
            where.append("signal_snapshot_id = ?")
            params.append(signal_snapshot_id)
        params.append(limit)
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM signal_observations
            WHERE {" AND ".join(where)}
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
            """,
            tuple(params),
        )
        return [
            _model_from_json(SignalObservation, row["payload_json"]) for row in rows
        ]

    def get_signal_observation(
        self,
        observation_id: str,
        *,
        workspace_id: str = "local",
    ) -> SignalObservation | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM signal_observations
            WHERE id = ? AND workspace_id = ?
            """,
            (observation_id, workspace_id),
        )
        return _model_from_json(SignalObservation, row["payload_json"]) if row else None

    def save_signal_outcome_labels(
        self,
        labels: list[SignalOutcomeLabel],
        *,
        _conn=None,
    ) -> list[SignalOutcomeLabel]:
        if not labels:
            return []
        self._save_payload_rows(
            "signal_outcome_labels",
            [
                (
                    label.id,
                    label.workspace_id,
                    label.observation_id,
                    label.symbol,
                    label.horizon_minutes,
                    label.label_status,
                    label.label_version,
                    model_to_json(label),
                    _iso(label.created_at),
                )
                for label in labels
            ],
            """
            INSERT INTO signal_outcome_labels (
                id, workspace_id, observation_id, symbol, horizon_minutes,
                label_status, label_version, payload_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            _conn=_conn,
        )
        return labels

    def list_signal_outcome_labels(
        self,
        *,
        workspace_id: str = "local",
        observation_id: str | None = None,
        symbol: str | None = None,
        horizon_minutes: int | None = None,
        limit: int = 100,
    ) -> list[SignalOutcomeLabel]:
        where = ["workspace_id = ?"]
        params: list[Any] = [workspace_id]
        if observation_id:
            where.append("observation_id = ?")
            params.append(observation_id)
        if symbol:
            where.append("symbol = ?")
            params.append(symbol)
        if horizon_minutes is not None:
            where.append("horizon_minutes = ?")
            params.append(horizon_minutes)
        params.append(limit)
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM signal_outcome_labels
            WHERE {" AND ".join(where)}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            tuple(params),
        )
        return [
            _model_from_json(SignalOutcomeLabel, row["payload_json"]) for row in rows
        ]

    def save_signal_evaluation_report(
        self,
        report: SignalEvaluationReport,
        *,
        _conn=None,
    ) -> SignalEvaluationReport:
        self._save_payload_rows(
            "signal_evaluation_reports",
            [
                (
                    report.id,
                    report.workspace_id,
                    report.report_version,
                    _iso(report.generated_at),
                    report.symbol,
                    report.factor_name,
                    report.horizon_minutes,
                    model_to_json(report),
                )
            ],
            """
            INSERT INTO signal_evaluation_reports (
                id, workspace_id, report_version, generated_at, symbol,
                factor_name, horizon_minutes, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            _conn=_conn,
        )
        return report

    def save_signal_weight_version(
        self,
        version: SignalWeightVersion,
        *,
        _conn=None,
    ) -> SignalWeightVersion:
        self._save_payload_rows(
            "signal_weight_versions",
            [
                (
                    version.id,
                    version.workspace_id,
                    version.version,
                    version.status,
                    version.horizon_minutes,
                    model_to_json(version),
                    _iso(version.created_at),
                    _iso(version.promoted_at),
                )
            ],
            """
            INSERT INTO signal_weight_versions (
                id, workspace_id, version, status, horizon_minutes,
                payload_json, created_at, promoted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                payload_json = excluded.payload_json,
                promoted_at = excluded.promoted_at
            """,
            _conn=_conn,
        )
        return version

    def list_signal_weight_versions(
        self,
        *,
        workspace_id: str = "local",
        limit: int = 100,
    ) -> list[SignalWeightVersion]:
        return self._list_payload_rows(
            SignalWeightVersion,
            "signal_weight_versions",
            workspace_id=workspace_id,
            order_column="created_at",
            limit=limit,
        )

    def save_signal_calibrator_version(
        self,
        version: SignalCalibratorVersion,
        *,
        _conn=None,
    ) -> SignalCalibratorVersion:
        self._save_payload_rows(
            "signal_calibrator_versions",
            [
                (
                    version.id,
                    version.workspace_id,
                    version.version,
                    version.weight_version,
                    version.status,
                    version.horizon_minutes,
                    int(version.publishable),
                    model_to_json(version),
                    _iso(version.created_at),
                    _iso(version.promoted_at),
                )
            ],
            """
            INSERT INTO signal_calibrator_versions (
                id, workspace_id, version, weight_version, status,
                horizon_minutes, publishable, payload_json, created_at, promoted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                publishable = excluded.publishable,
                payload_json = excluded.payload_json,
                promoted_at = excluded.promoted_at
            """,
            _conn=_conn,
        )
        return version

    def list_signal_calibrator_versions(
        self,
        *,
        workspace_id: str = "local",
        limit: int = 100,
    ) -> list[SignalCalibratorVersion]:
        return self._list_payload_rows(
            SignalCalibratorVersion,
            "signal_calibrator_versions",
            workspace_id=workspace_id,
            order_column="created_at",
            limit=limit,
        )

    def save_signal_model_promotion(
        self,
        promotion: SignalModelPromotion,
        *,
        _conn=None,
    ) -> SignalModelPromotion:
        self._save_payload_rows(
            "signal_model_promotions",
            [
                (
                    promotion.id,
                    promotion.workspace_id,
                    promotion.to_weight_version,
                    promotion.to_calibrator_version,
                    _iso(promotion.promoted_at),
                    model_to_json(promotion),
                )
            ],
            """
            INSERT INTO signal_model_promotions (
                id, workspace_id, to_weight_version, to_calibrator_version,
                promoted_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            _conn=_conn,
        )
        return promotion

    def list_signal_model_promotions(
        self,
        *,
        workspace_id: str = "local",
        limit: int = 100,
    ) -> list[SignalModelPromotion]:
        return self._list_payload_rows(
            SignalModelPromotion,
            "signal_model_promotions",
            workspace_id=workspace_id,
            order_column="promoted_at",
            limit=limit,
        )

    def save_signal_monitoring_snapshot(
        self,
        snapshot: SignalModelMonitoringSnapshot,
        *,
        _conn=None,
    ) -> SignalModelMonitoringSnapshot:
        self._save_payload_rows(
            "signal_model_monitoring_snapshots",
            [
                (
                    snapshot.id,
                    snapshot.workspace_id,
                    _iso(snapshot.generated_at),
                    snapshot.status,
                    snapshot.active_weight_version,
                    snapshot.active_calibrator_version,
                    model_to_json(snapshot),
                )
            ],
            """
            INSERT INTO signal_model_monitoring_snapshots (
                id, workspace_id, generated_at, status, active_weight_version,
                active_calibrator_version, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            _conn=_conn,
        )
        return snapshot

    def list_signal_monitoring_snapshots(
        self,
        *,
        workspace_id: str = "local",
        limit: int = 100,
    ) -> list[SignalModelMonitoringSnapshot]:
        return self._list_payload_rows(
            SignalModelMonitoringSnapshot,
            "signal_model_monitoring_snapshots",
            workspace_id=workspace_id,
            order_column="generated_at",
            limit=limit,
        )

    def save_signal_model_alert(
        self,
        alert: SignalModelAlert,
        *,
        _conn=None,
    ) -> SignalModelAlert:
        self._save_payload_rows(
            "signal_model_alerts",
            [
                (
                    alert.id,
                    alert.workspace_id,
                    alert.alert_type,
                    alert.severity,
                    alert.status,
                    alert.active_weight_version,
                    alert.active_calibrator_version,
                    alert.symbol,
                    alert.factor_name,
                    alert.message,
                    json.dumps(alert.evidence_json, ensure_ascii=True),
                    model_to_json(alert),
                    _iso(alert.created_at),
                    _iso(alert.acknowledged_at),
                    _iso(alert.resolved_at),
                )
            ],
            """
            INSERT INTO signal_model_alerts (
                id, workspace_id, alert_type, severity, status,
                active_weight_version, active_calibrator_version, symbol,
                factor_name, message, evidence_json, payload_json, created_at,
                acknowledged_at, resolved_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                acknowledged_at = excluded.acknowledged_at,
                resolved_at = excluded.resolved_at,
                payload_json = excluded.payload_json
            """,
            _conn=_conn,
        )
        return alert

    def list_signal_model_alerts(
        self,
        *,
        workspace_id: str = "local",
        status: str | None = None,
        limit: int = 100,
    ) -> list[SignalModelAlert]:
        where = ["workspace_id = ?"]
        params: list[Any] = [workspace_id]
        if status:
            where.append("status = ?")
            params.append(status)
        params.append(limit)
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM signal_model_alerts
            WHERE {" AND ".join(where)}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            tuple(params),
        )
        return [_model_from_json(SignalModelAlert, row["payload_json"]) for row in rows]

    def save_signal_model_rollback(
        self,
        rollback: SignalModelRollback,
        *,
        _conn=None,
    ) -> SignalModelRollback:
        self._save_payload_rows(
            "signal_model_rollbacks",
            [
                (
                    rollback.id,
                    rollback.workspace_id,
                    rollback.from_weight_version,
                    rollback.to_weight_version,
                    rollback.from_calibrator_version,
                    rollback.to_calibrator_version,
                    _iso(rollback.executed_at),
                    model_to_json(rollback),
                )
            ],
            """
            INSERT INTO signal_model_rollbacks (
                id, workspace_id, from_weight_version, to_weight_version,
                from_calibrator_version, to_calibrator_version, executed_at,
                payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            _conn=_conn,
        )
        return rollback

    def list_signal_model_rollbacks(
        self,
        *,
        workspace_id: str = "local",
        limit: int = 100,
    ) -> list[SignalModelRollback]:
        return self._list_payload_rows(
            SignalModelRollback,
            "signal_model_rollbacks",
            workspace_id=workspace_id,
            order_column="executed_at",
            limit=limit,
        )

    def _save_payload_rows(
        self,
        _table: str,
        rows: list[tuple[Any, ...]],
        sql: str,
        *,
        _conn=None,
    ) -> None:
        if not rows:
            return None
        if _conn is not None:
            _conn.executemany(sql, rows)
            return None
        with self.store.transaction() as conn:
            conn.executemany(sql, rows)
        return None

    def _list_payload_rows(
        self,
        model_cls,
        table: str,
        *,
        workspace_id: str,
        order_column: str,
        limit: int,
    ):
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM {table}
            WHERE workspace_id = ?
            ORDER BY {order_column} DESC, id DESC
            LIMIT ?
            """,
            (workspace_id, limit),
        )
        return [_model_from_json(model_cls, row["payload_json"]) for row in rows]


def _model_from_json(model_cls, payload_json: str):
    payload = json.loads(payload_json)
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)
