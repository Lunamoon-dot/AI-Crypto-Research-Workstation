"""Versioned signal evaluation models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

ObservationKind = Literal["factor", "composite"]
SignalAvailability = Literal["valid", "missing", "stale", "parse_failed", "error"]
SignalObservationDirection = Literal[
    "bullish", "bearish", "neutral", "mixed", "unknown"
]
SignalOutcomeStatus = Literal[
    "complete",
    "insufficient_forward_data",
    "missing_entry_price",
    "missing_atr",
    "provider_error",
    "not_directional",
]
SignalOutcomeDirectionLabel = Literal["up", "flat", "down", "unknown"]
SignalMonitoringStatus = Literal["healthy", "degraded", "critical", "insufficient_data"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SignalObservation(BaseModel):
    id: str
    workspace_id: str
    research_run_id: str | None = None
    signal_snapshot_id: str | None = None
    signal_id: str | None = None
    symbol: str
    timeframe: str = "unknown"
    observed_at: datetime
    source_timestamp: datetime | None = None
    observation_kind: ObservationKind
    factor_name: str
    factor_family: str
    direction: SignalObservationDirection
    directional_edge: float | None = None
    heuristic_strength: float | None = None
    detector_confidence: float | None = None
    data_quality: float | None = None
    availability: SignalAvailability
    raw_value: float | None = None
    threshold_breached: bool = False
    market_regime: str = "unknown"
    volatility_regime: str = "unknown"
    provider: str | None = None
    source_snapshot_hash: str | None = None
    code_sha: str | None = None
    signal_weight_version: str = "unknown"
    signal_threshold_version: str = "unknown"
    detector_version: str = "unknown"
    evidence_json: dict[str, Any] = Field(default_factory=dict)
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class SignalOutcomeLabel(BaseModel):
    id: str
    workspace_id: str
    observation_id: str
    symbol: str
    horizon_minutes: int
    label_status: SignalOutcomeStatus
    entry_price: float | None = None
    exit_price: float | None = None
    forward_return: float | None = None
    benchmark_return: float | None = None
    excess_return: float | None = None
    volatility_adjusted_return: float | None = None
    mfe: float | None = None
    mae: float | None = None
    direction_label: SignalOutcomeDirectionLabel = "unknown"
    signal_direction: SignalObservationDirection
    signed_return: float | None = None
    direction_correct: bool | None = None
    upper_barrier_pct: float | None = None
    lower_barrier_pct: float | None = None
    upper_barrier_hit: bool | None = None
    lower_barrier_hit: bool | None = None
    first_barrier: Literal["upper", "lower", "timeout", "unknown"] | None = None
    time_to_first_barrier_minutes: int | None = None
    data_quality: Literal["complete", "partial", "insufficient"] = "insufficient"
    provider: str | None = None
    candle_count: int = 0
    expected_candle_count: int | None = None
    label_version: str = "signal_outcome_label:v1"
    evidence_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class SignalEvaluationReport(BaseModel):
    id: str
    workspace_id: str
    report_version: str = "signal_evaluation_report:v1"
    generated_at: datetime = Field(default_factory=utc_now)
    symbol: str | None = None
    factor_name: str | None = None
    factor_family: str | None = None
    horizon_minutes: int
    timeframe: str | None = None
    market_regime: str | None = None
    volatility_regime: str | None = None
    sample_size: int = 0
    directional_sample_size: int = 0
    oos_sample_size: int = 0
    coverage_rate: float | None = None
    missing_rate: float | None = None
    stale_rate: float | None = None
    parse_failure_rate: float | None = None
    balanced_accuracy: float | None = None
    precision_bullish: float | None = None
    precision_bearish: float | None = None
    recall_bullish: float | None = None
    recall_bearish: float | None = None
    mcc: float | None = None
    spearman_ic: float | None = None
    rank_ic: float | None = None
    brier_score: float | None = None
    log_loss: float | None = None
    ece: float | None = None
    calibration_slope: float | None = None
    calibration_intercept: float | None = None
    mean_signed_return: float | None = None
    median_signed_return: float | None = None
    expectancy: float | None = None
    profit_factor: float | None = None
    average_mfe: float | None = None
    average_mae: float | None = None
    downside_deviation: float | None = None
    folds_json: dict[str, Any] = Field(default_factory=dict)
    buckets_json: dict[str, Any] = Field(default_factory=dict)
    breakdown_json: dict[str, Any] = Field(default_factory=dict)
    quality_warnings: list[str] = Field(default_factory=list)


class SignalWeightVersion(BaseModel):
    id: str
    workspace_id: str
    version: str
    status: Literal["candidate", "shadow", "promoted", "retired", "rejected"]
    horizon_minutes: int
    timeframe: str = "unknown"
    model_type: str = "logistic_regression_l2"
    feature_schema_version: str = "signal_features:v1"
    label_version: str = "signal_outcome_label:v1"
    training_window_start: datetime | None = None
    training_window_end: datetime | None = None
    weights_json: dict[str, Any] = Field(default_factory=dict)
    feature_stats_json: dict[str, Any] = Field(default_factory=dict)
    fold_metrics_json: dict[str, Any] = Field(default_factory=dict)
    oos_metrics_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    promoted_at: datetime | None = None


class SignalCalibratorVersion(BaseModel):
    id: str
    workspace_id: str
    version: str
    weight_version: str
    status: Literal["candidate", "shadow", "promoted", "retired", "rejected"]
    horizon_minutes: int
    method: Literal["platt", "isotonic", "beta", "none"] = "platt"
    params_json: dict[str, Any] = Field(default_factory=dict)
    calibration_metrics_json: dict[str, Any] = Field(default_factory=dict)
    sample_size: int = 0
    oos_sample_size: int = 0
    publishable: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    promoted_at: datetime | None = None


class SignalModelPromotion(BaseModel):
    id: str
    workspace_id: str
    from_weight_version: str | None = None
    to_weight_version: str
    from_calibrator_version: str | None = None
    to_calibrator_version: str
    promoted_by: str
    promoted_at: datetime = Field(default_factory=utc_now)
    policy_json: dict[str, Any] = Field(default_factory=dict)
    evidence_report_id: str


class SignalTrainingCandidate(BaseModel):
    weight_version: SignalWeightVersion
    calibrator_version: SignalCalibratorVersion
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class SignalModelMonitoringSnapshot(BaseModel):
    id: str
    workspace_id: str
    generated_at: datetime = Field(default_factory=utc_now)
    window_start: datetime
    window_end: datetime
    active_weight_version: str | None = None
    active_calibrator_version: str | None = None
    horizon_minutes: int | None = None
    observation_count: int = 0
    matured_label_count: int = 0
    publishable_prediction_count: int = 0
    data_health_json: dict[str, Any] = Field(default_factory=dict)
    feature_drift_json: dict[str, Any] = Field(default_factory=dict)
    calibration_health_json: dict[str, Any] = Field(default_factory=dict)
    prediction_health_json: dict[str, Any] = Field(default_factory=dict)
    breakdown_json: dict[str, Any] = Field(default_factory=dict)
    alerts_json: list[dict[str, Any]] = Field(default_factory=list)
    status: SignalMonitoringStatus


class SignalModelAlert(BaseModel):
    id: str
    workspace_id: str
    alert_type: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["open", "acknowledged", "resolved"] = "open"
    active_weight_version: str | None = None
    active_calibrator_version: str | None = None
    symbol: str | None = None
    factor_name: str | None = None
    message: str
    evidence_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None


class SignalModelRollback(BaseModel):
    id: str
    workspace_id: str
    from_weight_version: str
    to_weight_version: str
    from_calibrator_version: str
    to_calibrator_version: str
    reason: str
    evidence_snapshot_id: str
    requested_by: str
    executed_at: datetime = Field(default_factory=utc_now)
