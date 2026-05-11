"""Convert quant signal-engine output into journal-ready domain signals."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from tradingagents.domain import (
    DataFreshness,
    Signal,
    SignalDirection,
    SignalProvenance,
)
from tradingagents.exceptions import StaleDataError
from tradingagents.observability import log_event
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore

logger = logging.getLogger(__name__)

FRESHNESS_WINDOW = timedelta(hours=24)


def signal_score_to_direction(score: SignalScore) -> SignalDirection:
    """Map the quant layer's 5-tier score to journal signal direction."""
    if score in (SignalScore.STRONG_BUY, SignalScore.BUY):
        return SignalDirection.BULLISH
    if score in (SignalScore.STRONG_SELL, SignalScore.SELL):
        return SignalDirection.BEARISH
    if score == SignalScore.NEUTRAL:
        return SignalDirection.NEUTRAL
    return SignalDirection.UNKNOWN


def parse_signal_timestamp(timestamp: str | None) -> datetime | None:
    """Parse SignalResult timestamps without guessing when the shape is invalid."""
    if not timestamp:
        return None
    try:
        normalized = timestamp.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def freshness_from_timestamp(
    source_timestamp: datetime | None,
    *,
    now: datetime | None = None,
    mode: str | None = None,
    symbol: str = "",
    source: str = "",
) -> tuple[DataFreshness, int | None]:
    """Return freshness state and data age in seconds.

    When *mode* is ``"fail_fast"`` and the data is STALE, raises
    :exc:`StaleDataError` instead of returning the enum.
    """
    if source_timestamp is None:
        return DataFreshness.UNKNOWN, None

    observed_at = now or datetime.now(timezone.utc)
    age = observed_at - source_timestamp
    age_seconds = max(int(age.total_seconds()), 0)
    if age <= FRESHNESS_WINDOW:
        return DataFreshness.FRESH, age_seconds

    age_hours = round(age_seconds / 3600.0, 2)
    log_event(
        logger,
        "stale_data_detected",
        source=source or "signal_timestamp",
        symbol=symbol,
        age_hours=age_hours,
        mode=mode or "warn",
    )
    if mode == "fail_fast":
        raise StaleDataError(
            f"Data from {source or 'unknown'} is stale "
            f"({age_hours}h old, threshold={FRESHNESS_WINDOW.total_seconds() / 3600:.0f}h)"
        )
    return DataFreshness.STALE, age_seconds


def signal_result_to_domain_signals(
    result: SignalResult,
    *,
    now: datetime | None = None,
    stale_mode: str | None = None,
    reliability_map: dict[str, dict[str, float | int]] | None = None,
) -> list[Signal]:
    """Convert a SignalResult plus factors into domain Signal records.

    *reliability_map* is an optional dict mapping signal_type to
    ``{"historical_reliability": float, "sample_size": int}`` for
    populating provenance with observed historical performance.
    """
    observed_at = now or datetime.now(timezone.utc)
    source_timestamp = parse_signal_timestamp(result.timestamp)
    freshness, freshness_seconds = freshness_from_timestamp(
        source_timestamp,
        now=observed_at,
        mode=stale_mode,
        symbol=result.symbol,
        source="signal_engine",
    )

    signals = [
        _composite_signal(
            result, source_timestamp, freshness, freshness_seconds, observed_at
        )
    ]
    signals.extend(
        _factor_signal(
            result,
            factor,
            source_timestamp,
            freshness,
            freshness_seconds,
            observed_at,
        )
        for factor in result.factors
    )

    # Populate historical_reliability and sample_size from evaluation data (Phase 3 tail)
    if reliability_map:
        for signal in signals:
            stats = reliability_map.get(signal.signal_type)
            if stats:
                if "historical_reliability" in stats:
                    signal.provenance.historical_reliability = float(
                        stats["historical_reliability"]
                    )
                if "sample_size" in stats:
                    signal.provenance.sample_size = int(stats["sample_size"])

    return signals


def _composite_signal(
    result: SignalResult,
    source_timestamp: datetime | None,
    freshness: DataFreshness,
    freshness_seconds: int | None,
    observed_at: datetime,
) -> Signal:
    direction = signal_score_to_direction(result.score)
    return Signal(
        symbol=result.symbol,
        signal_type="composite_quant",
        direction=direction,
        strength=result.confidence,
        confidence=result.confidence,
        observed_at=observed_at,
        provenance=SignalProvenance(
            source="signal_engine",
            source_timestamp=source_timestamp,
            observed_at=observed_at,
            freshness=freshness,
            freshness_seconds=freshness_seconds,
            confidence=result.confidence,
            metadata={
                "score": result.score.value,
                "factor_count": len(result.factors),
            },
        ),
        evidence={
            "score": result.score.value,
            "current_price": result.current_price,
            "trend_direction": result.trend_direction,
            "trend_strength": result.trend_strength,
            "volatility_regime": result.volatility_regime,
            "market_regime": result.market_regime,
        },
        summary=result.summary,
    )


def _factor_signal(
    result: SignalResult,
    factor: FactorSignal,
    source_timestamp: datetime | None,
    freshness: DataFreshness,
    freshness_seconds: int | None,
    observed_at: datetime,
) -> Signal:
    direction = signal_score_to_direction(factor.score)
    confidence = factor.confidence
    return Signal(
        symbol=result.symbol,
        signal_type=factor.name,
        direction=direction,
        strength=confidence,
        confidence=confidence,
        observed_at=observed_at,
        provenance=SignalProvenance(
            source=factor.name,
            source_timestamp=source_timestamp,
            observed_at=observed_at,
            freshness=freshness,
            freshness_seconds=freshness_seconds,
            confidence=confidence,
            metadata={
                "score": factor.score.value,
                "data_quality": factor.data_quality,
                "threshold_breached": factor.threshold_breached,
                "raw_metadata": factor.metadata,
            },
        ),
        evidence={
            "value": factor.value,
            "score": factor.score.value,
            "detail": factor.detail,
            "data_quality": factor.data_quality,
            "threshold_breached": factor.threshold_breached,
        },
        summary=factor.detail,
    )


def build_reliability_map_from_evaluations(
    evaluations: list,
) -> dict[str, dict[str, float | int]]:
    """Build a reliability map from evaluation analytics data.

    Accepts a list of objects that have ``signal_type`` (or ``key``),
    ``historical_reliability``, and ``sample_size`` attributes —
    typically the result of ``EvaluationService.build_factor_reliability()``.
    """
    result: dict[str, dict[str, float | int]] = {}
    for evaluation in evaluations:
        key = (
            getattr(evaluation, "signal_type", None)
            or getattr(evaluation, "key", None)
            or getattr(evaluation, "factor_name", None)
        )
        if not key:
            continue
        entry: dict[str, float | int] = {}
        if hasattr(evaluation, "historical_reliability"):
            entry["historical_reliability"] = float(evaluation.historical_reliability)
        elif hasattr(evaluation, "hit_rate"):
            entry["historical_reliability"] = float(evaluation.hit_rate)
        if hasattr(evaluation, "sample_size"):
            entry["sample_size"] = int(evaluation.sample_size)
        if entry:
            result[key] = entry
    return result
