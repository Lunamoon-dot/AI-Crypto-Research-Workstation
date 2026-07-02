"""Signal model monitoring and rollback helpers."""

from __future__ import annotations

from datetime import timedelta
from math import log
from typing import Any
from uuid import uuid4

from .models import (
    SignalModelAlert,
    SignalModelMonitoringSnapshot,
    SignalModelRollback,
    SignalMonitoringStatus,
    SignalObservation,
    SignalOutcomeLabel,
    utc_now,
)


def build_monitoring_snapshot(
    *,
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    active_weight_version: str | None,
    active_calibrator_version: str | None,
    workspace_id: str,
    horizon_minutes: int | None = None,
    publishable_prediction_count: int = 0,
    baseline_feature_stats_json: dict[str, Any] | None = None,
    baseline_metrics_json: dict[str, Any] | None = None,
) -> SignalModelMonitoringSnapshot:
    now = utc_now()
    scoped_observations = [
        observation
        for observation in observations
        if observation.workspace_id == workspace_id
    ]
    scoped_labels = [label for label in labels if label.workspace_id == workspace_id]
    data_health = _data_health(scoped_observations)
    calibration_health = _calibration_health(
        scoped_observations,
        scoped_labels,
        horizon_minutes=horizon_minutes,
        baseline_metrics_json=baseline_metrics_json or {},
    )
    feature_drift = _feature_drift(
        scoped_observations, baseline_feature_stats_json or {}
    )
    prediction_health = _prediction_health(
        len(scoped_observations),
        publishable_prediction_count,
    )
    alerts: list[dict[str, Any]] = []
    if not active_weight_version or not active_calibrator_version:
        alerts.append(
            {
                "alert_type": "model_version_missing",
                "severity": "critical",
                "message": "No promoted signal model version is active.",
            }
        )
    alerts.extend(_data_health_alerts(data_health))
    alerts.extend(_feature_drift_alerts(feature_drift))
    alerts.extend(_prediction_health_alerts(prediction_health))
    alerts.extend(_calibration_alerts(calibration_health))
    status = _status(alerts, scoped_labels)
    return SignalModelMonitoringSnapshot(
        id=f"signal_monitoring_{uuid4().hex}",
        workspace_id=workspace_id,
        window_start=now - timedelta(days=7),
        window_end=now,
        active_weight_version=active_weight_version,
        active_calibrator_version=active_calibrator_version,
        horizon_minutes=horizon_minutes,
        observation_count=len(scoped_observations),
        matured_label_count=len(scoped_labels),
        publishable_prediction_count=publishable_prediction_count,
        data_health_json=data_health,
        feature_drift_json=feature_drift,
        calibration_health_json=calibration_health,
        prediction_health_json=prediction_health,
        breakdown_json={
            "availability": _counts(scoped_observations, "availability"),
            "factor_name": _counts(scoped_observations, "factor_name"),
            "factor_family": _counts(scoped_observations, "factor_family"),
            "symbol": _counts(scoped_observations, "symbol"),
        },
        alerts_json=alerts,
        status=status,
    )


def dedupe_alerts(
    *,
    existing_alerts: list[SignalModelAlert],
    new_alerts: list[dict[str, Any]],
    workspace_id: str,
) -> list[SignalModelAlert]:
    open_keys = {
        (alert.alert_type, alert.symbol, alert.factor_name)
        for alert in existing_alerts
        if alert.workspace_id == workspace_id and alert.status == "open"
    }
    result = list(existing_alerts)
    for alert in new_alerts:
        key = (
            str(alert.get("alert_type")),
            alert.get("symbol"),
            alert.get("factor_name"),
        )
        if key in open_keys:
            continue
        result.append(
            SignalModelAlert(
                id=f"signal_alert_{uuid4().hex}",
                workspace_id=workspace_id,
                alert_type=key[0],
                severity=alert.get("severity", "warning"),
                symbol=key[1],
                factor_name=key[2],
                message=str(alert.get("message") or key[0]),
                evidence_json=dict(alert.get("evidence") or {}),
            )
        )
        open_keys.add(key)
    return result


def rollback_active_model(
    *,
    from_weight_version: str,
    from_calibrator_version: str,
    to_weight_version: str,
    to_calibrator_version: str,
    promoted_versions: set[str],
    workspace_id: str,
    evidence_snapshot_id: str,
    reason: str,
    requested_by: str = "system",
) -> SignalModelRollback:
    if to_weight_version not in promoted_versions:
        raise ValueError("rollback target must be a previously promoted weight version")
    return SignalModelRollback(
        id=f"signal_rollback_{uuid4().hex}",
        workspace_id=workspace_id,
        from_weight_version=from_weight_version,
        from_calibrator_version=from_calibrator_version,
        to_weight_version=to_weight_version,
        to_calibrator_version=to_calibrator_version,
        reason=reason,
        evidence_snapshot_id=evidence_snapshot_id,
        requested_by=requested_by,
    )


def _data_health(observations: list[SignalObservation]) -> dict[str, Any]:
    total = len(observations)
    if total == 0:
        return {
            "coverage_rate": None,
            "missing_rate": None,
            "stale_rate": None,
            "parse_failure_rate": None,
        }
    valid = sum(
        1 for observation in observations if observation.availability == "valid"
    )
    missing = sum(
        1 for observation in observations if observation.availability == "missing"
    )
    stale = sum(
        1 for observation in observations if observation.availability == "stale"
    )
    parse_failed = sum(
        1 for observation in observations if observation.availability == "parse_failed"
    )
    provider_error = sum(
        1 for observation in observations if observation.availability == "error"
    )
    return {
        "coverage_rate": valid / total,
        "missing_rate": missing / total,
        "stale_rate": stale / total,
        "parse_failure_rate": parse_failed / total,
        "provider_error_rate": provider_error / total,
        "valid_factor_count": valid,
    }


def _data_health_alerts(data_health: dict[str, Any]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    parse_failure_rate = data_health.get("parse_failure_rate")
    stale_rate = data_health.get("stale_rate")
    if parse_failure_rate is not None and parse_failure_rate > 0.15:
        alerts.append(
            {
                "alert_type": "parse_failure_spike",
                "severity": "critical",
                "message": "Signal parse failure rate is above critical threshold.",
                "evidence": {"parse_failure_rate": parse_failure_rate},
            }
        )
    elif parse_failure_rate is not None and parse_failure_rate > 0.05:
        alerts.append(
            {
                "alert_type": "parse_failure_spike",
                "severity": "warning",
                "message": "Signal parse failure rate is above warning threshold.",
                "evidence": {"parse_failure_rate": parse_failure_rate},
            }
        )
    if stale_rate is not None and stale_rate > 0.10:
        alerts.append(
            {
                "alert_type": "stale_data_spike",
                "severity": "warning",
                "message": "Signal stale-data rate is above warning threshold.",
                "evidence": {"stale_rate": stale_rate},
            }
        )
    return alerts


def _feature_drift(
    observations: list[SignalObservation],
    baseline_feature_stats_json: dict[str, Any],
) -> dict[str, Any]:
    values = [
        float(observation.heuristic_strength)
        for observation in observations
        if observation.heuristic_strength is not None
    ]
    baseline = baseline_feature_stats_json.get("heuristic_strength") or {}
    baseline_mean = _number(baseline.get("mean"))
    current_mean = sum(values) / len(values) if values else None
    psi = (
        abs(current_mean - baseline_mean)
        if current_mean is not None and baseline_mean is not None
        else None
    )
    return {
        "heuristic_strength": {
            "current_mean": current_mean,
            "baseline_mean": baseline_mean,
            "psi": psi,
            "ks_statistic": psi,
        }
    }


def _feature_drift_alerts(feature_drift: dict[str, Any]) -> list[dict[str, Any]]:
    psi = feature_drift.get("heuristic_strength", {}).get("psi")
    if psi is None:
        return []
    if psi > 0.35:
        return [
            {
                "alert_type": "feature_drift_critical",
                "severity": "critical",
                "message": "Signal feature distribution drift is critical.",
                "evidence": {"psi": psi},
            }
        ]
    if psi > 0.20:
        return [
            {
                "alert_type": "feature_drift_warning",
                "severity": "warning",
                "message": "Signal feature distribution drift is elevated.",
                "evidence": {"psi": psi},
            }
        ]
    return []


def _prediction_health(
    total_observations: int, publishable_prediction_count: int
) -> dict[str, Any]:
    publishable_rate = (
        publishable_prediction_count / total_observations
        if total_observations
        else None
    )
    return {
        "publishable_rate": publishable_rate,
        "null_probability_rate": None
        if publishable_rate is None
        else 1 - publishable_rate,
        "publishable_prediction_count": publishable_prediction_count,
    }


def _prediction_health_alerts(
    prediction_health: dict[str, Any],
) -> list[dict[str, Any]]:
    publishable_rate = prediction_health.get("publishable_rate")
    if publishable_rate is None:
        return []
    if publishable_rate < 0.5:
        return [
            {
                "alert_type": "probability_unavailable_spike",
                "severity": "critical",
                "message": "Publishable signal probabilities are below critical threshold.",
                "evidence": {"publishable_rate": publishable_rate},
            }
        ]
    if publishable_rate < 0.8:
        return [
            {
                "alert_type": "probability_unavailable_spike",
                "severity": "warning",
                "message": "Publishable signal probabilities are below warning threshold.",
                "evidence": {"publishable_rate": publishable_rate},
            }
        ]
    return []


def _calibration_health(
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    *,
    horizon_minutes: int | None,
    baseline_metrics_json: dict[str, Any],
) -> dict[str, Any]:
    observations_by_id = {observation.id: observation for observation in observations}
    complete = [
        label
        for label in labels
        if label.label_status == "complete"
        and label.direction_correct is not None
        and (horizon_minutes is None or label.horizon_minutes == horizon_minutes)
        and label.observation_id in observations_by_id
    ]
    scores = [_score(observations_by_id[label.observation_id]) for label in complete]
    outcomes = [1.0 if label.direction_correct else 0.0 for label in complete]
    brier = _brier(scores, outcomes)
    ece = _ece(scores, outcomes)
    log_loss = _log_loss(scores, outcomes)
    return {
        "sample_size": len(complete),
        "rolling_brier": brier,
        "rolling_ece": ece,
        "rolling_log_loss": log_loss,
        "baseline_brier": _number(baseline_metrics_json.get("brier_score")),
        "baseline_ece": _number(baseline_metrics_json.get("ece")),
    }


def _calibration_alerts(
    calibration_health: dict[str, Any],
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    rolling_ece = calibration_health.get("rolling_ece")
    baseline_ece = calibration_health.get("baseline_ece")
    rolling_brier = calibration_health.get("rolling_brier")
    baseline_brier = calibration_health.get("baseline_brier")
    if rolling_ece is not None and baseline_ece is not None:
        delta = rolling_ece - baseline_ece
        if delta > 0.06:
            alerts.append(
                {
                    "alert_type": "calibration_drift_critical",
                    "severity": "critical",
                    "message": "Rolling calibration error is above critical threshold.",
                    "evidence": {
                        "rolling_ece": rolling_ece,
                        "baseline_ece": baseline_ece,
                    },
                }
            )
        elif delta > 0.03:
            alerts.append(
                {
                    "alert_type": "calibration_drift_warning",
                    "severity": "warning",
                    "message": "Rolling calibration error is above warning threshold.",
                    "evidence": {
                        "rolling_ece": rolling_ece,
                        "baseline_ece": baseline_ece,
                    },
                }
            )
    if (
        rolling_brier is not None
        and baseline_brier is not None
        and rolling_brier - baseline_brier > 0.04
    ):
        alerts.append(
            {
                "alert_type": "oos_performance_regression",
                "severity": "critical",
                "message": "Rolling Brier score regressed beyond threshold.",
                "evidence": {
                    "rolling_brier": rolling_brier,
                    "baseline_brier": baseline_brier,
                },
            }
        )
    return alerts


def _status(
    alerts: list[dict[str, Any]],
    labels: list[SignalOutcomeLabel],
) -> SignalMonitoringStatus:
    severities = {str(alert.get("severity")) for alert in alerts}
    if "critical" in severities:
        return (
            "insufficient_data"
            if any(
                alert.get("alert_type") == "model_version_missing" for alert in alerts
            )
            and not labels
            else "critical"
        )
    if "warning" in severities:
        return "degraded"
    return "healthy" if labels else "insufficient_data"


def _score(observation: SignalObservation) -> float:
    if observation.heuristic_strength is not None:
        return min(max(float(observation.heuristic_strength), 0.0), 1.0)
    return min(max(abs(float(observation.directional_edge or 0.0)), 0.0), 1.0)


def _brier(scores: list[float], outcomes: list[float]) -> float | None:
    return (
        sum((score - outcome) ** 2 for score, outcome in zip(scores, outcomes))
        / len(scores)
        if scores
        else None
    )


def _log_loss(scores: list[float], outcomes: list[float]) -> float | None:
    if not scores:
        return None
    total = 0.0
    for score, outcome in zip(scores, outcomes):
        p = min(max(score, 1e-6), 1 - 1e-6)
        total += -(outcome * log(p) + (1 - outcome) * log(1 - p))
    return total / len(scores)


def _ece(
    scores: list[float], outcomes: list[float], bucket_count: int = 10
) -> float | None:
    if not scores:
        return None
    total = len(scores)
    weighted_error = 0.0
    for bucket in range(bucket_count):
        lo = bucket / bucket_count
        hi = (bucket + 1) / bucket_count
        indexes = [
            idx
            for idx, score in enumerate(scores)
            if lo <= score < hi or (bucket == bucket_count - 1 and score == 1.0)
        ]
        if not indexes:
            continue
        mean_predicted = sum(scores[idx] for idx in indexes) / len(indexes)
        actual_rate = sum(outcomes[idx] for idx in indexes) / len(indexes)
        weighted_error += (len(indexes) / total) * abs(actual_rate - mean_predicted)
    return weighted_error


def _counts(observations: list[SignalObservation], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for observation in observations:
        value = str(getattr(observation, field) or "unknown")
        counts[value] = counts.get(value, 0) + 1
    return counts


def _number(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
