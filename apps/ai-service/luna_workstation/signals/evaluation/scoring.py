"""Runtime scoring helpers for promoted signal probability artifacts."""

from __future__ import annotations

from dataclasses import replace
from math import exp, log
from typing import Any

from luna_workstation.signals.base import FactorSignal, SignalResult, SignalScore

from .models import SignalCalibratorVersion, SignalWeightVersion
from .training import FEATURE_COLUMNS

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


def apply_promoted_probability_to_result(
    result: SignalResult,
    weight_version: SignalWeightVersion | None,
    calibrator_version: SignalCalibratorVersion | None,
) -> SignalResult:
    """Attach empirical probability when the active model is publishable.

    The learned path is additive: it never changes the heuristic composite
    score or confidence. It only fills the empirical fields that downstream
    API/UI code already gates by sample size.
    """

    probability = score_signal_result_probability(
        result,
        weight_version,
        calibrator_version,
    )
    if probability is None or not weight_version or not calibrator_version:
        return replace(
            result,
            empirical_confidence=None,
            empirical_sample_size=0,
            empirical_oos_sample_size=0,
        )
    return replace(
        result,
        empirical_confidence=probability,
        empirical_sample_size=calibrator_version.sample_size,
        empirical_oos_sample_size=calibrator_version.oos_sample_size,
        signal_weight_version=weight_version.version,
    )


def score_signal_result_probability(
    result: SignalResult,
    weight_version: SignalWeightVersion | None,
    calibrator_version: SignalCalibratorVersion | None,
) -> float | None:
    if not _is_publishable(weight_version, calibrator_version):
        return None
    assert weight_version is not None
    assert calibrator_version is not None
    weights_payload = weight_version.weights_json or {}
    model_weights = _number_map(weights_payload.get("weights"))
    if not model_weights:
        return None
    feature_columns = _string_list(weights_payload.get("feature_columns")) or FEATURE_COLUMNS
    features = build_signal_result_feature_vector(result)
    raw_score = _number(weights_payload.get("intercept")) or 0.0
    for column in feature_columns:
        raw_score += model_weights.get(column, 0.0) * features.get(column, 0.0)
    base_probability = _sigmoid(raw_score)
    return _calibrate_probability(base_probability, calibrator_version.params_json)


def build_signal_result_feature_vector(result: SignalResult) -> dict[str, float]:
    vector = {column: 0.0 for column in FEATURE_COLUMNS}
    for factor in result.factors:
        edge_column, quality_column = _FACTOR_FEATURES.get(
            factor.name,
            ("regime_edge", "regime_quality"),
        )
        vector[edge_column] = _factor_edge(factor)
        vector[quality_column] = max(float(factor.data_quality or 0.0), 0.0)
        if factor.data_quality and factor.data_quality > 0:
            vector["valid_factor_count"] += 1.0
        else:
            vector["missing_factor_count"] += 1.0

    regime = (result.market_regime or "").lower()
    volatility = (result.volatility_regime or "").lower()
    vector["is_trending"] = 1.0 if "trend" in regime else 0.0
    vector["is_ranging"] = 1.0 if "range" in regime else 0.0
    vector["is_high_vol"] = 1.0 if "high" in volatility else 0.0
    vector["is_extreme_vol"] = 1.0 if "extreme" in volatility else 0.0
    return vector


def _is_publishable(
    weight_version: SignalWeightVersion | None,
    calibrator_version: SignalCalibratorVersion | None,
) -> bool:
    return (
        weight_version is not None
        and calibrator_version is not None
        and weight_version.status == "promoted"
        and calibrator_version.status == "promoted"
        and calibrator_version.publishable
        and calibrator_version.weight_version == weight_version.version
    )


def _factor_edge(factor: FactorSignal) -> float:
    confidence = max(min(float(factor.confidence or 0.0), 1.0), 0.0)
    if factor.score in (SignalScore.STRONG_BUY, SignalScore.BUY):
        return confidence
    if factor.score in (SignalScore.STRONG_SELL, SignalScore.SELL):
        return -confidence
    return 0.0


def _calibrate_probability(probability: float, params: dict[str, Any]) -> float:
    method = str(params.get("method") or "platt").lower()
    if method == "none":
        return _clamp_probability(probability)
    slope = _number(params.get("slope")) or 1.0
    intercept = _number(params.get("intercept")) or 0.0
    logit = log(_clamp_probability(probability) / (1.0 - _clamp_probability(probability)))
    return _clamp_probability(_sigmoid(slope * logit + intercept))


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = exp(-value)
        return 1 / (1 + z)
    z = exp(value)
    return z / (1 + z)


def _clamp_probability(value: float) -> float:
    return max(min(float(value), 1.0 - 1e-9), 1e-9)


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _number_map(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): parsed
        for key, item in value.items()
        if (parsed := _number(item)) is not None
    }


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]
