"""Point-in-time forward outcome labeling for signal observations."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import re

from .models import (
    SignalObservation,
    SignalObservationDirection,
    SignalOutcomeDirectionLabel,
    SignalOutcomeLabel,
    SignalOutcomeStatus,
)

LABEL_VERSION = "signal_outcome_label:v1"


def label_observation_outcome(
    observation: SignalObservation,
    candles: list[dict[str, Any]],
    *,
    horizon_minutes: int,
    atr_pct: float | None = None,
    min_return_threshold: float = 0.0025,
    flat_atr_mult: float = 0.10,
) -> SignalOutcomeLabel:
    label_id = _label_id(observation.id, horizon_minutes, LABEL_VERSION)
    if observation.availability != "valid":
        return _empty_label(
            label_id,
            observation,
            horizon_minutes,
            "not_directional",
            evidence={"reason": "observation_unavailable"},
        )

    forward = _forward_candles(observation.observed_at, candles, horizon_minutes)
    if not forward:
        return _empty_label(
            label_id,
            observation,
            horizon_minutes,
            "insufficient_forward_data",
            evidence={"candidate_candle_count": len(candles)},
        )

    entry_price = _number(forward[0].get("open"))
    exit_price = _number(forward[-1].get("close"))
    if entry_price is None or entry_price <= 0:
        return _empty_label(
            label_id, observation, horizon_minutes, "missing_entry_price"
        )
    if exit_price is None:
        return _empty_label(
            label_id, observation, horizon_minutes, "insufficient_forward_data"
        )

    forward_return = (exit_price - entry_price) / entry_price
    threshold = max(min_return_threshold, (atr_pct or 0.0) * flat_atr_mult)
    direction_label: SignalOutcomeDirectionLabel = (
        "up"
        if forward_return > threshold
        else "down"
        if forward_return < -threshold
        else "flat"
    )
    signed_return = _signed_return(observation.direction, forward_return)
    direction_correct = signed_return > threshold if signed_return is not None else None
    mfe, mae = _excursions(observation.direction, entry_price, forward)
    barrier = _barrier_result(observation.observed_at, entry_price, forward, atr_pct)
    evidence = {
        "first_candle_at": _timestamp(forward[0]).isoformat(),
        "last_candle_at": _timestamp(forward[-1]).isoformat(),
        **barrier["evidence"],
    }

    return SignalOutcomeLabel(
        id=label_id,
        workspace_id=observation.workspace_id,
        observation_id=observation.id,
        symbol=observation.symbol,
        horizon_minutes=horizon_minutes,
        label_status="complete",
        entry_price=entry_price,
        exit_price=exit_price,
        forward_return=forward_return,
        mfe=mfe,
        mae=mae,
        direction_label=direction_label,
        signal_direction=observation.direction,
        signed_return=signed_return,
        direction_correct=direction_correct,
        upper_barrier_pct=atr_pct,
        lower_barrier_pct=atr_pct,
        upper_barrier_hit=barrier["upper_hit"],
        lower_barrier_hit=barrier["lower_hit"],
        first_barrier=barrier["first_barrier"],
        time_to_first_barrier_minutes=barrier["minutes"],
        data_quality="complete",
        provider=observation.provider,
        candle_count=len(forward),
        expected_candle_count=len(forward),
        label_version=LABEL_VERSION,
        evidence_json=evidence,
    )


def _empty_label(
    label_id: str,
    observation: SignalObservation,
    horizon_minutes: int,
    status: SignalOutcomeStatus,
    *,
    evidence: dict[str, Any] | None = None,
) -> SignalOutcomeLabel:
    return SignalOutcomeLabel(
        id=label_id,
        workspace_id=observation.workspace_id,
        observation_id=observation.id,
        symbol=observation.symbol,
        horizon_minutes=horizon_minutes,
        label_status=status,
        signal_direction=observation.direction,
        label_version=LABEL_VERSION,
        evidence_json=evidence or {},
    )


def _label_id(observation_id: str, horizon_minutes: int, label_version: str) -> str:
    version_key = re.sub(r"[^a-zA-Z0-9]+", "_", label_version).strip("_")
    return f"signal_outcome_{observation_id}_{horizon_minutes}_{version_key}"


def _forward_candles(
    observed_at: datetime,
    candles: list[dict[str, Any]],
    horizon_minutes: int,
) -> list[dict[str, Any]]:
    end = observed_at + timedelta(minutes=horizon_minutes)
    selected = []
    for candle in candles:
        ts = _timestamp(candle)
        if observed_at < ts <= end:
            selected.append(candle)
    return sorted(selected, key=_timestamp)


def _timestamp(candle: dict[str, Any]) -> datetime:
    value = candle.get("timestamp") or candle.get("time") or candle.get("date")
    if isinstance(value, datetime):
        return (
            value.astimezone(timezone.utc)
            if value.tzinfo
            else value.replace(tzinfo=timezone.utc)
        )
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (
        parsed.astimezone(timezone.utc)
        if parsed.tzinfo
        else parsed.replace(tzinfo=timezone.utc)
    )


def _signed_return(
    direction: SignalObservationDirection,
    forward_return: float,
) -> float | None:
    if direction == "bullish":
        return forward_return
    if direction == "bearish":
        return -forward_return
    return None


def _excursions(
    direction: SignalObservationDirection,
    entry_price: float,
    candles: list[dict[str, Any]],
) -> tuple[float | None, float | None]:
    raw_highs = [_number(candle.get("high")) for candle in candles]
    raw_lows = [_number(candle.get("low")) for candle in candles]
    highs: list[float] = [value for value in raw_highs if value is not None]
    lows: list[float] = [value for value in raw_lows if value is not None]
    if not highs or not lows:
        return None, None
    if direction == "bearish":
        return (entry_price - min(lows)) / entry_price, -(
            (max(highs) - entry_price) / entry_price
        )
    return (max(highs) - entry_price) / entry_price, -(
        (entry_price - min(lows)) / entry_price
    )


def _barrier_result(
    observed_at: datetime,
    entry_price: float,
    candles: list[dict[str, Any]],
    atr_pct: float | None,
) -> dict[str, Any]:
    if atr_pct is None:
        return {
            "first_barrier": None,
            "upper_hit": None,
            "lower_hit": None,
            "minutes": None,
            "evidence": {},
        }
    upper = entry_price * (1 + atr_pct)
    lower = entry_price * (1 - atr_pct)
    for candle in candles:
        high = _number(candle.get("high"))
        low = _number(candle.get("low"))
        if high is None or low is None:
            continue
        upper_hit = high >= upper
        lower_hit = low <= lower
        if upper_hit or lower_hit:
            minutes = int((_timestamp(candle) - observed_at).total_seconds() / 60)
            if upper_hit and lower_hit:
                return {
                    "first_barrier": "unknown",
                    "upper_hit": True,
                    "lower_hit": True,
                    "minutes": minutes,
                    "evidence": {"same_candle_barrier_ambiguity": True},
                }
            return {
                "first_barrier": "upper" if upper_hit else "lower",
                "upper_hit": upper_hit,
                "lower_hit": lower_hit,
                "minutes": minutes,
                "evidence": {},
            }
    return {
        "first_barrier": "timeout",
        "upper_hit": False,
        "lower_hit": False,
        "minutes": None,
        "evidence": {},
    }


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
