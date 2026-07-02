from datetime import datetime, timedelta, timezone

import pytest

from luna_workstation.domain import Signal, SignalDirection, SignalProvenance
from luna_workstation.signals.base import FactorSignal, SignalScore
from luna_workstation.signals.composite import CompositeScorer
from luna_workstation.signals.evaluation.labeler import label_observation_outcome
from luna_workstation.signals.evaluation.dataset_builder import build_labeling_candidates
from luna_workstation.signals.evaluation.metrics import build_signal_evaluation_report
from luna_workstation.signals.evaluation.models import (
    SignalCalibratorVersion,
    SignalModelAlert,
    SignalModelMonitoringSnapshot,
    SignalObservation,
    SignalOutcomeLabel,
    SignalWeightVersion,
)
from luna_workstation.signals.evaluation.monitoring import (
    build_monitoring_snapshot,
    dedupe_alerts,
    rollback_active_model,
)
from luna_workstation.signals.evaluation.observations import observation_from_signal
from luna_workstation.signals.evaluation.scoring import (
    apply_promoted_probability_to_result,
)
from luna_workstation.signals.evaluation.training import (
    train_signal_model_candidate,
    validate_promotion_gates,
)


def _observed_at() -> datetime:
    return datetime(2026, 6, 1, 12, tzinfo=timezone.utc)


def _signal(
    signal_id: str = "sig_1",
    signal_type: str = "regime",
    direction: SignalDirection = SignalDirection.NEUTRAL,
    confidence: float = 0.4,
    data_quality: float = 1.0,
    availability: str = "valid",
) -> Signal:
    return Signal(
        id=signal_id,
        workspace_id="ws_1",
        symbol="BTC/USDT",
        signal_type=signal_type,
        direction=direction,
        confidence=confidence,
        observed_at=_observed_at(),
        provenance=SignalProvenance(
            source="signal_engine",
            observed_at=_observed_at(),
            metadata={"availability": availability},
        ),
        evidence={
            "data_quality": data_quality,
            "availability": availability,
            "market_regime": "trending",
            "volatility_regime": "normal",
        },
    )


def _observation(
    observation_id: str = "obs_1",
    direction: str = "bullish",
    observed_at: datetime | None = None,
    heuristic_strength: float = 0.7,
) -> SignalObservation:
    return SignalObservation(
        id=observation_id,
        workspace_id="ws_1",
        symbol="BTC/USDT",
        timeframe="1h",
        observed_at=observed_at or _observed_at(),
        observation_kind="factor",
        factor_name="regime",
        factor_family="price_structure",
        direction=direction,
        directional_edge=heuristic_strength if direction == "bullish" else -heuristic_strength,
        heuristic_strength=heuristic_strength,
        detector_confidence=heuristic_strength,
        data_quality=1.0,
        availability="valid",
        threshold_breached=False,
        market_regime="trending",
        volatility_regime="normal",
        signal_weight_version="heuristic:v1",
        signal_threshold_version="unknown",
        detector_version="unknown",
    )


def _label(
    observation_id: str,
    direction_correct: bool,
    signed_return: float,
    observed_at: datetime,
) -> SignalOutcomeLabel:
    return SignalOutcomeLabel(
        id=f"label_{observation_id}",
        workspace_id="ws_1",
        observation_id=observation_id,
        symbol="BTC/USDT",
        horizon_minutes=1440,
        label_status="complete",
        entry_price=100.0,
        exit_price=101.0 if direction_correct else 99.0,
        forward_return=0.01 if direction_correct else -0.01,
        signal_direction="bullish",
        signed_return=signed_return,
        direction_correct=direction_correct,
        direction_label="up" if direction_correct else "down",
        data_quality="complete",
        candle_count=24,
        expected_candle_count=24,
        label_version="signal_outcome_label:v1",
        evidence_json={"observed_at": observed_at.isoformat()},
    )


def test_observation_from_signal_normalizes_factor_contract_and_stable_id():
    signal = _signal(direction=SignalDirection.NEUTRAL, confidence=0.0)

    first = observation_from_signal(
        signal,
        research_run_id="run_1",
        signal_snapshot_id="snap_1",
    )
    second = observation_from_signal(
        signal,
        research_run_id="run_1",
        signal_snapshot_id="snap_1",
    )

    assert first.id == second.id
    assert first.observation_kind == "factor"
    assert first.factor_family == "price_structure"
    assert first.directional_edge == 0.0
    assert first.availability == "valid"


def test_observation_from_signal_excludes_unavailable_directional_edge():
    signal = _signal(
        direction=SignalDirection.BEARISH,
        confidence=0.7,
        data_quality=0.0,
        availability="parse_failed",
    )

    observation = observation_from_signal(signal)

    assert observation.availability == "parse_failed"
    assert observation.directional_edge is None


def test_labeler_marks_bullish_direction_correct_and_barrier_ambiguity():
    observation = _observation(direction="bullish")
    candles = [
        {
            "timestamp": (_observed_at() + timedelta(minutes=60)).isoformat(),
            "open": 100.0,
            "high": 103.0,
            "low": 97.0,
            "close": 101.0,
        },
        {
            "timestamp": (_observed_at() + timedelta(minutes=120)).isoformat(),
            "open": 101.0,
            "high": 104.0,
            "low": 100.5,
            "close": 103.0,
        },
    ]

    label = label_observation_outcome(
        observation,
        candles,
        horizon_minutes=240,
        atr_pct=0.02,
    )

    assert label.label_status == "complete"
    assert label.direction_correct is True
    assert label.first_barrier == "unknown"
    assert label.evidence_json["same_candle_barrier_ambiguity"] is True


def test_labeler_is_idempotent_by_observation_horizon_and_version():
    observation = _observation(observation_id="obs_stable")
    label = label_observation_outcome(
        observation,
        [
            {
                "timestamp": (_observed_at() + timedelta(minutes=60)).isoformat(),
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
            }
        ],
        horizon_minutes=60,
    )

    assert label.id == "signal_outcome_obs_stable_60_signal_outcome_label_v1"


def test_dataset_builder_selects_matured_unlabeled_valid_observations():
    now = _observed_at() + timedelta(days=3)
    matured = _observation("obs_matured", observed_at=_observed_at())
    fresh = _observation("obs_fresh", observed_at=now - timedelta(hours=4))
    unavailable = _observation("obs_missing", observed_at=_observed_at())
    unavailable.availability = "missing"
    existing = _label("obs_matured", True, 0.03, matured.observed_at)

    candidates = build_labeling_candidates(
        [matured, fresh, unavailable],
        existing_labels=[existing],
        workspace_id="ws_1",
        now=now,
        horizon_minutes=1440,
        label_version="signal_outcome_label:v1",
    )

    assert candidates == []

    candidates_without_existing = build_labeling_candidates(
        [matured, fresh, unavailable],
        existing_labels=[],
        workspace_id="ws_1",
        now=now,
        horizon_minutes=1440,
        label_version="signal_outcome_label:v1",
    )

    assert [candidate.id for candidate in candidates_without_existing] == ["obs_matured"]


def test_metrics_report_uses_chronological_oos_folds_and_embargo():
    start = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    observations = [
        _observation(f"obs_{idx}", observed_at=start + timedelta(days=idx), heuristic_strength=0.8 if idx % 2 == 0 else 0.2)
        for idx in range(8)
    ]
    labels = [
        _label(observation.id, idx % 2 == 0, 0.03 if idx % 2 == 0 else -0.02, observation.observed_at)
        for idx, observation in enumerate(observations)
    ]

    report = build_signal_evaluation_report(
        observations,
        labels,
        workspace_id="ws_1",
        horizon_minutes=1440,
        train_window_days=3,
        calibration_window_days=1,
        test_window_days=2,
        embargo_days=1,
        min_train_samples=2,
        min_test_samples=2,
        min_oos_samples=1,
    )

    assert report.sample_size == 8
    assert report.oos_sample_size == 2
    assert report.folds_json["fold_count"] == 1
    fold = report.folds_json["folds"][0]
    assert fold["train_sample_size"] == 3
    assert fold["test_sample_size"] == 2
    assert fold["embargo_days"] == 1
    assert report.brier_score == pytest.approx(((0.2 - 0) ** 2 + (0.8 - 1) ** 2) / 2)
    assert report.log_loss is not None
    assert report.balanced_accuracy == 1.0


def test_training_fails_closed_when_sample_gates_are_not_met():
    candidate = train_signal_model_candidate(
        [_observation("obs_1")],
        [_label("obs_1", True, 0.02, _observed_at())],
        workspace_id="ws_1",
        horizon_minutes=1440,
    )

    assert isinstance(candidate.weight_version, SignalWeightVersion)
    assert isinstance(candidate.calibrator_version, SignalCalibratorVersion)
    assert candidate.calibrator_version.publishable is False
    assert candidate.calibrator_version.params_json["reason"] == "insufficient_data"


def test_training_candidate_is_deterministic_and_records_feature_weights():
    start = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    observations = [
        _observation(f"train_obs_{idx}", observed_at=start + timedelta(days=idx), heuristic_strength=0.75 if idx % 2 == 0 else 0.25)
        for idx in range(8)
    ]
    labels = [
        _label(observation.id, idx % 2 == 0, 0.04 if idx % 2 == 0 else -0.03, observation.observed_at)
        for idx, observation in enumerate(observations)
    ]

    first = train_signal_model_candidate(
        observations,
        labels,
        workspace_id="ws_1",
        horizon_minutes=1440,
        train_window_days=3,
        calibration_window_days=1,
        test_window_days=2,
        embargo_days=1,
        min_train_samples=2,
        min_calibration_samples=1,
        min_oos_samples=2,
        min_folds=1,
    )
    second = train_signal_model_candidate(
        observations,
        labels,
        workspace_id="ws_1",
        horizon_minutes=1440,
        train_window_days=3,
        calibration_window_days=1,
        test_window_days=2,
        embargo_days=1,
        min_train_samples=2,
        min_calibration_samples=1,
        min_oos_samples=2,
        min_folds=1,
    )

    assert first.weight_version.version == second.weight_version.version
    assert first.calibrator_version.version == second.calibrator_version.version
    assert first.calibrator_version.publishable is True
    assert first.weight_version.weights_json["feature_schema_version"] == "signal_features:v1"
    assert "regime_edge" in first.weight_version.weights_json["feature_columns"]
    assert first.weight_version.weights_json["weights"]["regime_edge"] != 0
    assert first.calibrator_version.params_json["method"] == "platt"


def test_runtime_probability_requires_promoted_publishable_versions():
    result = CompositeScorer().score(
        [
            FactorSignal(
                name="regime",
                score=SignalScore.BUY,
                confidence=0.8,
                value=1.0,
                threshold_breached=True,
                data_quality=1.0,
            )
        ],
        symbol="BTC/USDT",
        market_regime="trending",
        volatility_regime="normal",
    )
    weight = SignalWeightVersion(
        id="weight_promoted",
        workspace_id="ws_1",
        version="signal_weights:v1:1440:test",
        status="promoted",
        horizon_minutes=1440,
        weights_json={
            "feature_columns": ["regime_edge"],
            "weights": {"regime_edge": 2.0},
            "intercept": 0.0,
        },
    )
    calibrator = SignalCalibratorVersion(
        id="calibrator_promoted",
        workspace_id="ws_1",
        version="signal_calibrator:v1:1440:test",
        weight_version=weight.version,
        status="promoted",
        horizon_minutes=1440,
        params_json={"method": "platt", "slope": 1.0, "intercept": 0.0},
        sample_size=200,
        oos_sample_size=160,
        publishable=True,
    )

    scored = apply_promoted_probability_to_result(result, weight, calibrator)

    assert scored.empirical_confidence is not None
    assert scored.empirical_sample_size == 200
    assert scored.empirical_oos_sample_size == 160
    assert scored.empirical_confidence_is_publishable() is True
    assert scored.signal_weight_version == weight.version

    calibrator.status = "shadow"
    calibrator.publishable = True
    blocked = apply_promoted_probability_to_result(result, weight, calibrator)
    assert blocked.empirical_confidence is None


def test_promotion_gates_require_oos_improvement():
    assert (
        validate_promotion_gates(
            candidate_metrics={
                "oos_sample_size": 150,
                "fold_count": 3,
                "ece": 0.04,
                "brier_score": 0.2,
                "log_loss": 0.55,
                "balanced_accuracy": 0.61,
            },
            baseline_metrics={
                "ece": 0.06,
                "brier_score": 0.21,
                "log_loss": 0.55,
                "balanced_accuracy": 0.6,
            },
        )
        is True
    )
    assert (
        validate_promotion_gates(
            candidate_metrics={"oos_sample_size": 20, "fold_count": 1},
            baseline_metrics={},
        )
        is False
    )


def test_monitoring_snapshot_handles_no_promoted_model_and_data_health():
    snapshot = build_monitoring_snapshot(
        observations=[_observation("obs_1"), _observation("obs_2")],
        labels=[],
        active_weight_version=None,
        active_calibrator_version=None,
        workspace_id="ws_1",
    )

    assert isinstance(snapshot, SignalModelMonitoringSnapshot)
    assert snapshot.status == "insufficient_data"
    assert snapshot.data_health_json["coverage_rate"] == 1.0
    assert any(alert["alert_type"] == "model_version_missing" for alert in snapshot.alerts_json)


def test_monitoring_flags_data_quality_probability_and_feature_drift():
    observations = [
        _observation(f"drift_obs_{idx}", heuristic_strength=0.9)
        for idx in range(10)
    ]
    for observation in observations[:7]:
        observation.availability = "parse_failed"
        observation.directional_edge = None

    snapshot = build_monitoring_snapshot(
        observations=observations,
        labels=[],
        active_weight_version="weights:v1",
        active_calibrator_version="calibrator:v1",
        workspace_id="ws_1",
        publishable_prediction_count=2,
        baseline_feature_stats_json={"heuristic_strength": {"mean": 0.1}},
    )

    alert_types = {alert["alert_type"] for alert in snapshot.alerts_json}
    assert snapshot.status == "critical"
    assert "parse_failure_spike" in alert_types
    assert "probability_unavailable_spike" in alert_types
    assert "feature_drift_critical" in alert_types
    assert snapshot.feature_drift_json["heuristic_strength"]["psi"] > 0.35


def test_monitoring_calibration_health_uses_complete_matured_labels_only():
    observations = [
        _observation("cal_obs_1", heuristic_strength=0.8),
        _observation("cal_obs_2", heuristic_strength=0.2),
        _observation("cal_obs_3", heuristic_strength=0.9),
    ]
    labels = [
        _label("cal_obs_1", True, 0.02, observations[0].observed_at),
        _label("cal_obs_2", False, -0.01, observations[1].observed_at),
        SignalOutcomeLabel(
            id="label_unmatured",
            workspace_id="ws_1",
            observation_id="cal_obs_3",
            symbol="BTC/USDT",
            horizon_minutes=1440,
            label_status="insufficient_forward_data",
            signal_direction="bullish",
        ),
    ]

    snapshot = build_monitoring_snapshot(
        observations=observations,
        labels=labels,
        active_weight_version="weights:v1",
        active_calibrator_version="calibrator:v1",
        workspace_id="ws_1",
        horizon_minutes=1440,
    )

    assert snapshot.calibration_health_json["sample_size"] == 2
    assert snapshot.calibration_health_json["rolling_brier"] == pytest.approx(
        ((0.8 - 1) ** 2 + (0.2 - 0) ** 2) / 2
    )


def test_alert_deduping_and_rollback_rules():
    existing = SignalModelAlert(
        id="alert_1",
        workspace_id="ws_1",
        alert_type="provider_degraded",
        severity="warning",
        status="open",
        message="provider degraded",
    )
    deduped = dedupe_alerts(
        existing_alerts=[existing],
        new_alerts=[
            {
                "alert_type": "provider_degraded",
                "severity": "warning",
                "message": "provider degraded again",
            }
        ],
        workspace_id="ws_1",
    )

    assert len(deduped) == 1
    with pytest.raises(ValueError):
        rollback_active_model(
            from_weight_version="w2",
            from_calibrator_version="c2",
            to_weight_version="candidate_only",
            to_calibrator_version="c1",
            promoted_versions={"w1"},
            workspace_id="ws_1",
            evidence_snapshot_id="snap_1",
            reason="test",
        )
