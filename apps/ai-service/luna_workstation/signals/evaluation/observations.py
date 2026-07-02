"""Build immutable signal observations from persisted signal records."""

from __future__ import annotations

from hashlib import sha256
from typing import Any

from luna_workstation.domain import DataFreshness, Signal, SignalDirection

from .models import (
    ObservationKind,
    SignalAvailability,
    SignalObservation,
    SignalObservationDirection,
)


FACTOR_FAMILIES = {
    "rsi_divergence": "price_momentum",
    "macd": "price_momentum",
    "regime": "price_structure",
    "volume_profile": "volume",
    "funding_oi": "derivatives",
    "liquidations": "derivatives",
    "onchain": "market_structure_proxy",
    "quant_bias": "aggregate",
}


def observation_from_signal(
    signal: Signal,
    *,
    research_run_id: str | None = None,
    signal_snapshot_id: str | None = None,
    timeframe: str = "unknown",
) -> SignalObservation:
    evidence = dict(signal.evidence or {})
    metadata = dict(signal.provenance.metadata or {})
    signal_type = str(signal.signal_type or "unknown")
    kind: ObservationKind = "composite" if signal_type == "quant_bias" else "factor"
    availability = _availability(signal, evidence, metadata)
    direction = _direction(signal.direction)
    heuristic_strength = _number(
        evidence.get("heuristic_strength")
        or evidence.get("heuristic_confidence")
        or signal.heuristic_confidence
        or signal.confidence
        or signal.strength
    )
    data_quality = _number(evidence.get("data_quality") or metadata.get("data_quality"))
    directional_edge = _directional_edge(
        direction,
        availability,
        _number(evidence.get("directional_edge") or metadata.get("directional_edge")),
        heuristic_strength,
    )

    return SignalObservation(
        id=_observation_id(
            signal.workspace_id,
            research_run_id,
            signal_snapshot_id,
            signal.id,
            signal_type,
            signal.observed_at.isoformat(),
        ),
        workspace_id=signal.workspace_id,
        research_run_id=research_run_id,
        signal_snapshot_id=signal_snapshot_id,
        signal_id=signal.id,
        symbol=signal.symbol,
        timeframe=timeframe,
        observed_at=signal.observed_at,
        source_timestamp=signal.provenance.source_timestamp,
        observation_kind=kind,
        factor_name=signal_type if kind == "factor" else "quant_bias",
        factor_family=FACTOR_FAMILIES.get(signal_type, "unknown"),
        direction=direction,
        directional_edge=directional_edge,
        heuristic_strength=heuristic_strength,
        detector_confidence=signal.confidence,
        data_quality=data_quality,
        availability=availability,
        raw_value=_number(evidence.get("value") or metadata.get("raw_value")),
        threshold_breached=bool(evidence.get("threshold_breached", False)),
        market_regime=str(evidence.get("market_regime") or "unknown"),
        volatility_regime=str(evidence.get("volatility_regime") or "unknown"),
        provider=signal.provenance.source,
        source_snapshot_hash=_text(metadata.get("source_snapshot_hash")),
        code_sha=_text(metadata.get("code_sha")),
        signal_weight_version=signal.confidence_version or "unknown",
        signal_threshold_version=_text(metadata.get("signal_threshold_version"))
        or "unknown",
        detector_version=_text(metadata.get("detector_version")) or "unknown",
        evidence_json=evidence,
        metadata_json=metadata,
    )


def observations_from_signals(
    signals: list[Signal],
    *,
    research_run_id: str | None = None,
    signal_snapshot_id: str | None = None,
    timeframe: str = "unknown",
) -> list[SignalObservation]:
    return [
        observation_from_signal(
            signal,
            research_run_id=research_run_id,
            signal_snapshot_id=signal_snapshot_id,
            timeframe=timeframe,
        )
        for signal in signals
    ]


def _observation_id(*parts: Any) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return f"signal_observation_{sha256(raw.encode('utf-8')).hexdigest()[:24]}"


def _availability(
    signal: Signal,
    evidence: dict[str, Any],
    metadata: dict[str, Any],
) -> SignalAvailability:
    raw = str(
        evidence.get("availability") or metadata.get("availability") or ""
    ).lower()
    if raw == "valid":
        return "valid"
    if raw == "missing":
        return "missing"
    if raw == "stale":
        return "stale"
    if raw == "parse_failed":
        return "parse_failed"
    if raw == "error":
        return "error"
    if signal.provenance.freshness == DataFreshness.STALE:
        return "stale"
    if evidence.get("data_quality") == 0 or metadata.get("data_quality") == 0:
        return "missing"
    return "valid"


def _direction(direction: SignalDirection) -> SignalObservationDirection:
    value = str(getattr(direction, "value", str(direction)))
    if value == "bullish":
        return "bullish"
    if value == "bearish":
        return "bearish"
    if value == "neutral":
        return "neutral"
    if value == "mixed":
        return "mixed"
    if value == "unknown":
        return "unknown"
    return "unknown"


def _directional_edge(
    direction: SignalObservationDirection,
    availability: SignalAvailability,
    explicit: float | None,
    heuristic_strength: float | None,
) -> float | None:
    if availability != "valid":
        return None
    if explicit is not None:
        return explicit
    strength = float(heuristic_strength or 0.0)
    if direction == "bullish":
        return strength
    if direction == "bearish":
        return -strength
    if direction == "neutral":
        return 0.0
    return None


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None
