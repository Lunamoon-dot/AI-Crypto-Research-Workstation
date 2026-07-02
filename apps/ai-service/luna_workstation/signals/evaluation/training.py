"""Learned signal model candidate helpers."""

from __future__ import annotations

from hashlib import sha256
from math import exp
from typing import Any

from .metrics import build_signal_evaluation_report
from .models import (
    SignalCalibratorVersion,
    SignalObservation,
    SignalOutcomeLabel,
    SignalTrainingCandidate,
    SignalWeightVersion,
)

FEATURE_COLUMNS = [
    "rsi_edge",
    "macd_edge",
    "volume_edge",
    "regime_edge",
    "funding_oi_edge",
    "liquidation_edge",
    "market_structure_proxy_edge",
    "rsi_quality",
    "macd_quality",
    "volume_quality",
    "regime_quality",
    "funding_oi_quality",
    "liquidation_quality",
    "market_structure_proxy_quality",
    "is_trending",
    "is_ranging",
    "is_high_vol",
    "is_extreme_vol",
    "valid_factor_count",
    "missing_factor_count",
    "parse_failed_factor_count",
]

_FACTOR_FEATURES = {
    "rsi_divergence": ("rsi_edge", "rsi_quality"),
    "macd": ("macd_edge", "macd_quality"),
    "volume_profile": ("volume_edge", "volume_quality"),
    "regime": ("regime_edge", "regime_quality"),
    "funding_oi": ("funding_oi_edge", "funding_oi_quality"),
    "liquidations": ("liquidation_edge", "liquidation_quality"),
    "onchain": ("market_structure_proxy_edge", "market_structure_proxy_quality"),
    "quant_bias": ("regime_edge", "regime_quality"),
}


def train_signal_model_candidate(
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    *,
    workspace_id: str,
    horizon_minutes: int,
    train_window_days: int = 180,
    calibration_window_days: int = 30,
    test_window_days: int = 30,
    embargo_days: int | None = None,
    min_train_samples: int = 500,
    min_calibration_samples: int = 150,
    min_oos_samples: int = 150,
    min_folds: int = 3,
) -> SignalTrainingCandidate:
    report = build_signal_evaluation_report(
        observations,
        labels,
        workspace_id=workspace_id,
        horizon_minutes=horizon_minutes,
        train_window_days=train_window_days,
        calibration_window_days=calibration_window_days,
        test_window_days=test_window_days,
        embargo_days=embargo_days,
        min_train_samples=min_train_samples,
        min_test_samples=min_oos_samples,
        min_oos_samples=min_oos_samples,
    )
    dataset_key = _dataset_key(observations, labels, workspace_id, horizon_minutes)
    weight_version = f"signal_weights:v1:{horizon_minutes}:{dataset_key}"
    calibrator_version = f"signal_calibrator:v1:{horizon_minutes}:{dataset_key}"
    eligible = _eligible_training_rows(
        observations, labels, workspace_id, horizon_minutes
    )
    feature_rows = [
        build_feature_vector(observation) for observation, _label in eligible
    ]
    targets = [
        1.0 if label.direction_correct else 0.0 for _observation, label in eligible
    ]
    fold_count = int(report.folds_json.get("fold_count", 0))
    calibration_samples = sum(
        int(fold.get("calibration_sample_size", 0))
        for fold in report.folds_json.get("folds", [])
        if isinstance(fold, dict)
    )
    gate_fail = (
        report.directional_sample_size < min_train_samples
        or calibration_samples < min_calibration_samples
        or report.oos_sample_size < min_oos_samples
        or fold_count < min_folds
    )
    fitted_weights, intercept = (
        ({column: 0.0 for column in FEATURE_COLUMNS}, 0.0)
        if gate_fail
        else _fit_logistic(feature_rows, targets)
    )
    feature_stats = _feature_stats(feature_rows)
    weight_model = SignalWeightVersion(
        id=f"signal_weight_{dataset_key}",
        workspace_id=workspace_id,
        version=weight_version,
        status="candidate",
        horizon_minutes=horizon_minutes,
        training_window_start=min(
            (observation.observed_at for observation, _label in eligible), default=None
        ),
        training_window_end=max(
            (observation.observed_at for observation, _label in eligible), default=None
        ),
        weights_json={
            "feature_schema_version": "signal_features:v1",
            "feature_columns": FEATURE_COLUMNS,
            "intercept": intercept,
            "weights": fitted_weights,
        }
        if not gate_fail
        else {},
        feature_stats_json=feature_stats,
        fold_metrics_json=report.folds_json,
        oos_metrics_json=report.model_dump(mode="json"),
    )
    calibrator = SignalCalibratorVersion(
        id=f"signal_calibrator_{dataset_key}",
        workspace_id=workspace_id,
        version=calibrator_version,
        weight_version=weight_version,
        status="candidate",
        horizon_minutes=horizon_minutes,
        params_json={"reason": "insufficient_data"}
        if gate_fail
        else {"method": "platt", "intercept": 0.0, "slope": 1.0},
        calibration_metrics_json=report.model_dump(mode="json"),
        sample_size=report.directional_sample_size,
        oos_sample_size=report.oos_sample_size,
        publishable=not gate_fail,
    )
    return SignalTrainingCandidate(
        weight_version=weight_model,
        calibrator_version=calibrator,
        diagnostics={
            "min_train_samples": min_train_samples,
            "min_calibration_samples": min_calibration_samples,
            "min_oos_samples": min_oos_samples,
            "min_folds": min_folds,
            "calibration_samples": calibration_samples,
            "fold_count": fold_count,
            "gate_fail": gate_fail,
        },
    )


def build_feature_vector(observation: SignalObservation) -> dict[str, float]:
    vector = {column: 0.0 for column in FEATURE_COLUMNS}
    edge_column, quality_column = _FACTOR_FEATURES.get(
        observation.factor_name,
        ("regime_edge", "regime_quality"),
    )
    vector[edge_column] = float(observation.directional_edge or 0.0)
    vector[quality_column] = float(observation.data_quality or 0.0)
    regime = observation.market_regime.lower()
    volatility = observation.volatility_regime.lower()
    vector["is_trending"] = 1.0 if "trend" in regime else 0.0
    vector["is_ranging"] = 1.0 if "range" in regime else 0.0
    vector["is_high_vol"] = 1.0 if "high" in volatility else 0.0
    vector["is_extreme_vol"] = 1.0 if "extreme" in volatility else 0.0
    vector["valid_factor_count"] = 1.0 if observation.availability == "valid" else 0.0
    vector["missing_factor_count"] = (
        1.0 if observation.availability == "missing" else 0.0
    )
    vector["parse_failed_factor_count"] = (
        1.0 if observation.availability == "parse_failed" else 0.0
    )
    return vector


def validate_promotion_gates(
    *,
    candidate_metrics: dict[str, Any],
    baseline_metrics: dict[str, Any],
    min_oos_samples: int = 150,
    min_folds: int = 3,
    min_ece_improvement: float = 0.01,
    min_brier_improvement: float = 0.005,
    allowed_log_loss_tolerance: float = 0.01,
) -> bool:
    if int(candidate_metrics.get("oos_sample_size") or 0) < min_oos_samples:
        return False
    if int(candidate_metrics.get("fold_count") or 0) < min_folds:
        return False
    candidate_ece = _number(candidate_metrics.get("ece"))
    baseline_ece = _number(baseline_metrics.get("ece"))
    if candidate_ece is None or baseline_ece is None:
        return False
    if candidate_ece > baseline_ece - min_ece_improvement:
        return False
    candidate_brier = _number(candidate_metrics.get("brier_score"))
    baseline_brier = _number(baseline_metrics.get("brier_score"))
    if candidate_brier is None or baseline_brier is None:
        return False
    if candidate_brier > baseline_brier - min_brier_improvement:
        return False
    candidate_log_loss = _number(candidate_metrics.get("log_loss"))
    baseline_log_loss = _number(baseline_metrics.get("log_loss"))
    if candidate_log_loss is not None and baseline_log_loss is not None:
        if candidate_log_loss > baseline_log_loss + allowed_log_loss_tolerance:
            return False
    candidate_accuracy = _number(candidate_metrics.get("balanced_accuracy"))
    baseline_accuracy = _number(baseline_metrics.get("balanced_accuracy"))
    if candidate_accuracy is not None and baseline_accuracy is not None:
        if candidate_accuracy < baseline_accuracy:
            return False
    return True


def _number(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _eligible_training_rows(
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    workspace_id: str,
    horizon_minutes: int,
) -> list[tuple[SignalObservation, SignalOutcomeLabel]]:
    labels_by_observation = {
        label.observation_id: label
        for label in labels
        if label.workspace_id == workspace_id
        and label.horizon_minutes == horizon_minutes
        and label.label_status == "complete"
        and label.direction_correct is not None
    }
    return [
        (observation, labels_by_observation[observation.id])
        for observation in sorted(
            observations, key=lambda item: (item.observed_at, item.id)
        )
        if observation.workspace_id == workspace_id
        and observation.availability == "valid"
        and observation.direction in {"bullish", "bearish"}
        and observation.id in labels_by_observation
    ]


def _fit_logistic(
    feature_rows: list[dict[str, float]],
    targets: list[float],
    *,
    learning_rate: float = 0.2,
    l2: float = 0.01,
    iterations: int = 300,
) -> tuple[dict[str, float], float]:
    weights = {column: 0.0 for column in FEATURE_COLUMNS}
    intercept = 0.0
    if not feature_rows:
        return weights, intercept
    for _idx in range(iterations):
        gradients = {column: 0.0 for column in FEATURE_COLUMNS}
        intercept_gradient = 0.0
        for features, target in zip(feature_rows, targets):
            score = intercept + sum(
                weights[column] * features[column] for column in FEATURE_COLUMNS
            )
            prediction = _sigmoid(score)
            error = prediction - target
            intercept_gradient += error
            for column in FEATURE_COLUMNS:
                gradients[column] += error * features[column]
        row_count = len(feature_rows)
        intercept -= learning_rate * (intercept_gradient / row_count)
        for column in FEATURE_COLUMNS:
            penalty = l2 * weights[column]
            weights[column] -= learning_rate * (
                (gradients[column] / row_count) + penalty
            )
    return weights, intercept


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = exp(-value)
        return 1 / (1 + z)
    z = exp(value)
    return z / (1 + z)


def _feature_stats(feature_rows: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    stats: dict[str, dict[str, float]] = {}
    for column in FEATURE_COLUMNS:
        values = [row[column] for row in feature_rows]
        if not values:
            stats[column] = {"mean": 0.0, "min": 0.0, "max": 0.0}
            continue
        stats[column] = {
            "mean": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
        }
    return stats


def _dataset_key(
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    workspace_id: str,
    horizon_minutes: int,
) -> str:
    observation_ids = ",".join(
        sorted(
            observation.id
            for observation in observations
            if observation.workspace_id == workspace_id
        )
    )
    label_ids = ",".join(
        sorted(
            label.id
            for label in labels
            if label.workspace_id == workspace_id
            and label.horizon_minutes == horizon_minutes
        )
    )
    raw = f"{workspace_id}|{horizon_minutes}|{observation_ids}|{label_ids}"
    return sha256(raw.encode("utf-8")).hexdigest()[:16]
