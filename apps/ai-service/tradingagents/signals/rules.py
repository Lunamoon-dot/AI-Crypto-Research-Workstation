"""Canonical signal metadata and watch-condition rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SignalRule:
    """Registry entry for a deterministic signal factor."""

    signal_type: str
    lane: str
    category: str
    metrics: tuple[str, ...] = ()
    review_trigger: str = ""
    invalidation: str = ""


QUANT_BIAS = "quant_bias"
LEGACY_SIGNAL_ALIASES: dict[str, str] = {
    "composite_quant": QUANT_BIAS,
    "long_short_ratio": "long_short",
    "perp_basis": "basis",
    "open_interest": "oi",
}

_UNKNOWN_RULE = SignalRule(
    signal_type="unknown",
    lane="unknown",
    category="unknown",
    review_trigger=(
        "Review when this unclassified evidence changes bias or contradicts the "
        "current aggregate quant bias."
    ),
    invalidation=(
        "Invalidate this evidence if its source becomes stale or data quality is "
        "insufficient for the current thesis."
    ),
)

SIGNAL_RULES: dict[str, SignalRule] = {
    QUANT_BIAS: SignalRule(
        signal_type=QUANT_BIAS,
        lane=QUANT_BIAS,
        category="aggregate",
        metrics=("spot_lane", "perp_lane", "confidence"),
        review_trigger=(
            "Review when quant bias flips, confidence materially changes, or a "
            "spot/perp lane shows a high-confidence contradiction."
        ),
        invalidation=(
            "Invalidate the bias if spot and perp lanes both move against it, or "
            "if source freshness degrades."
        ),
    ),
    "funding_oi": SignalRule(
        signal_type="funding_oi",
        lane="perp",
        category="funding_oi",
        metrics=(
            "funding_rate",
            "funding_percentile",
            "oi_delta_5d",
            "price_delta_5d",
        ),
        review_trigger=(
            "Review if funding percentile rises above 90%, or if open interest "
            "rises while price is flat or falling."
        ),
        invalidation=(
            "Invalidate the funding/OI thesis if funding resets to neutral and "
            "open interest declines."
        ),
    ),
    "funding": SignalRule(
        signal_type="funding",
        lane="perp",
        category="funding",
        metrics=("funding_rate", "funding_percentile"),
        review_trigger="Review if funding percentile rises above 90%.",
        invalidation="Invalidate if funding resets to neutral.",
    ),
    "liquidations": SignalRule(
        signal_type="liquidations",
        lane="perp",
        category="liquidations",
        metrics=("liquidation_cluster", "long_liquidations", "short_liquidations"),
        review_trigger=(
            "Review if liquidation clusters build near thesis invalidation or "
            "confirmation levels."
        ),
        invalidation=(
            "Invalidate if liquidation pressure clears without confirming the "
            "thesis."
        ),
    ),
    "basis": SignalRule(
        signal_type="basis",
        lane="perp",
        category="basis",
        metrics=("basis", "basis_percentile"),
        review_trigger="Review when basis expands or compresses into an extreme band.",
        invalidation="Invalidate if basis normalizes against the thesis.",
    ),
    "oi": SignalRule(
        signal_type="oi",
        lane="perp",
        category="oi",
        metrics=("oi_current", "oi_delta_5d"),
        review_trigger=(
            "Review if open interest expands while price fails to confirm the "
            "thesis."
        ),
        invalidation="Invalidate if open interest unwinds against the thesis.",
    ),
    "long_short": SignalRule(
        signal_type="long_short",
        lane="perp",
        category="long_short",
        metrics=("long_short_ratio",),
        review_trigger="Review when long/short positioning moves into a crowded band.",
        invalidation="Invalidate if positioning normalizes against the thesis.",
    ),
    "macd": SignalRule(
        signal_type="macd",
        lane="spot",
        category="price",
        metrics=("macd_line", "signal_line", "histogram"),
        review_trigger=(
            "Review if the MACD histogram flips sign, or if a bullish/bearish "
            "crossover occurs."
        ),
        invalidation=(
            "Invalidate the momentum thesis if MACD crosses back in the opposite "
            "direction."
        ),
    ),
    "rsi_divergence": SignalRule(
        signal_type="rsi_divergence",
        lane="spot",
        category="price",
        metrics=("rsi", "price_high_low"),
        review_trigger=(
            "Review when RSI divergence appears, disappears, or reaches an "
            "overbought/oversold extreme."
        ),
        invalidation="Invalidate if RSI momentum no longer supports the thesis.",
    ),
    "volume_profile": SignalRule(
        signal_type="volume_profile",
        lane="spot",
        category="volume",
        metrics=("volume_node", "volume_delta"),
        review_trigger=(
            "Review when price moves through a high-volume node or volume fails "
            "to confirm the thesis."
        ),
        invalidation="Invalidate if volume confirms the opposing thesis.",
    ),
    "volume": SignalRule(
        signal_type="volume",
        lane="spot",
        category="volume",
        metrics=("volume",),
        review_trigger="Review when volume confirms or rejects the thesis.",
        invalidation="Invalidate if volume confirms the opposing thesis.",
    ),
    "regime": SignalRule(
        signal_type="regime",
        lane="spot",
        category="regime",
        metrics=("adx", "atr_pct", "market_regime"),
        review_trigger=(
            "Review if ADX rises above 20 or 25, or if the market regime shifts "
            "between range, trend, and high volatility."
        ),
        invalidation=(
            "Invalidate a range thesis if price breaks out with confirming volume."
        ),
    ),
    "onchain": SignalRule(
        signal_type="onchain",
        lane="spot",
        category="on-chain",
        metrics=("nvt", "long_short_ratio", "exchange_reserves"),
        review_trigger="Review if NVT moves outside its neutral band.",
        invalidation=(
            "Invalidate if on-chain evidence no longer supports the current thesis."
        ),
    ),
    "price": SignalRule(
        signal_type="price",
        lane="spot",
        category="price",
        metrics=("price",),
        review_trigger="Review when price confirms or rejects the thesis level.",
        invalidation="Invalidate if price action confirms the opposing thesis.",
    ),
    "relative_strength": SignalRule(
        signal_type="relative_strength",
        lane="spot",
        category="relative_strength",
        metrics=("relative_strength",),
        review_trigger="Review when relative strength changes regime.",
        invalidation="Invalidate if relative strength no longer supports the thesis.",
    ),
}


def canonical_signal_type(signal_type: str | None) -> str:
    """Return the canonical identifier for a legacy or current signal type."""
    key = str(signal_type or "").strip().lower()
    if not key:
        return "unknown"
    return LEGACY_SIGNAL_ALIASES.get(key, key)


def rule_for_signal_type(signal_type: str | None) -> SignalRule:
    """Return registry metadata for *signal_type* after alias normalization."""
    canonical = canonical_signal_type(signal_type)
    return SIGNAL_RULES.get(canonical, _UNKNOWN_RULE)


def classify_signal(signal_type: str | None) -> tuple[str, str, str]:
    """Return ``(canonical_signal_type, lane, category)``."""
    canonical = canonical_signal_type(signal_type)
    rule = rule_for_signal_type(canonical)
    return canonical, rule.lane, rule.category


def bias_from_score_or_direction(
    *,
    score: Any = None,
    direction: Any = None,
    fallback: str = "unknown",
) -> str:
    """Map legacy score/rating text or a current direction into signal bias."""
    direction_text = _clean(direction)
    if direction_text in {"bullish", "bearish", "neutral", "mixed"}:
        return direction_text

    score_text = _clean(score)
    if score_text in {"strong_buy", "buy", "overweight", "long"}:
        return "bullish"
    if score_text in {"strong_sell", "sell", "underweight", "short"}:
        return "bearish"
    if score_text in {"neutral", "hold", "watch"}:
        return "neutral"
    return fallback


def build_watch_condition_payload(
    *,
    symbol: str,
    signal_type: str,
    direction: str,
    lane: str,
    category: str,
    confidence: float | None = None,
    threshold_breached: bool | None = None,
) -> dict[str, str]:
    """Build persisted watch-condition text from the signal registry."""
    canonical = canonical_signal_type(signal_type)
    rule = rule_for_signal_type(canonical)
    bias = bias_from_score_or_direction(direction=direction, fallback="unknown")
    confidence_text = "unknown confidence"
    if confidence is not None:
        confidence_text = f"{confidence:.0%} confidence"

    if canonical == QUANT_BIAS or lane == QUANT_BIAS:
        return {
            "what_changed": (
                f"{symbol} aggregate quant bias is {bias} with {confidence_text}."
            ),
            "invalidation": rule.invalidation,
            "review_trigger": rule.review_trigger,
        }

    threshold_text = (
        " Threshold is breached." if threshold_breached else " No threshold breach."
    )
    lane_text = lane if lane != "unknown" else "unclassified"
    return {
        "what_changed": (
            f"{symbol} {lane_text} {category} evidence is {bias} for "
            f"{canonical} with {confidence_text}.{threshold_text}"
        ),
        "invalidation": rule.invalidation,
        "review_trigger": rule.review_trigger,
    }


def normalize_signal_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy signal JSON before validation or backfill persistence."""
    data = dict(payload)
    original_type = data.get("signal_type")
    canonical, lane, category = classify_signal(original_type)
    existing_evidence = dict(data.get("evidence") or {})
    existing_lane = str(
        data.get("evidence_lane") or existing_evidence.get("evidence_lane") or ""
    ).strip()
    existing_category = str(
        data.get("evidence_category")
        or existing_evidence.get("evidence_category")
        or ""
    ).strip()
    if lane == "unknown" and existing_lane in {"spot", "perp", "quant_bias"}:
        lane = existing_lane
    if category == "unknown" and existing_category:
        category = existing_category
    data["signal_type"] = canonical
    if not data.get("workspace_id"):
        data["workspace_id"] = "local"

    direction = bias_from_score_or_direction(
        score=(data.get("evidence") or {}).get("score")
        or (data.get("provenance") or {}).get("metadata", {}).get("score"),
        direction=data.get("direction"),
        fallback=str(data.get("direction") or "unknown").lower(),
    )
    if direction in {"bullish", "bearish", "neutral", "mixed", "unknown"}:
        data["direction"] = direction

    evidence = existing_evidence
    if "score" in evidence and "quant_bias" not in evidence:
        evidence["quant_bias"] = bias_from_score_or_direction(
            score=evidence.get("score"),
            direction=data.get("direction"),
            fallback=direction,
        )
    evidence.setdefault("quant_bias", direction)
    evidence["evidence_lane"] = lane
    evidence["evidence_category"] = category
    data["evidence"] = evidence

    provenance = dict(data.get("provenance") or {})
    metadata = dict(provenance.get("metadata") or {})
    if "score" in metadata and "quant_bias" not in metadata:
        metadata["quant_bias"] = bias_from_score_or_direction(
            score=metadata.get("score"),
            direction=data.get("direction"),
            fallback=direction,
        )
    metadata.setdefault("quant_bias", direction)
    metadata["evidence_lane"] = lane
    metadata["evidence_category"] = category
    provenance["metadata"] = metadata
    data["provenance"] = provenance

    if data.get("evidence_lane") in (None, "", "unknown") or original_type != canonical:
        data["evidence_lane"] = lane
    if data.get("evidence_category") in (None, "", "unknown") or original_type != canonical:
        data["evidence_category"] = category

    watch = data.get("watch_conditions")
    if not isinstance(watch, dict) or not any(str(v or "").strip() for v in watch.values()):
        data["watch_conditions"] = build_watch_condition_payload(
            symbol=str(data.get("symbol") or ""),
            signal_type=canonical,
            direction=str(data.get("direction") or direction),
            lane=lane,
            category=category,
            confidence=_optional_float(data.get("confidence")),
            threshold_breached=_optional_bool(evidence.get("threshold_breached")),
        )
    return data


def normalize_signal_snapshot_payload(
    payload: dict[str, Any],
    *,
    signal_payloads_by_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Normalize legacy signal snapshot JSON and lane id lists."""
    data = dict(payload)
    signal_ids = [str(item) for item in data.get("signal_ids") or [] if item]
    data["signal_ids"] = signal_ids
    if data.get("composite_signal_id") is None:
        data["composite_signal_id"] = _first_quant_bias_id(signal_ids, signal_payloads_by_id)

    nested = dict(data.get("payload") or {})
    nested["signal_types"] = [
        canonical_signal_type(item) for item in nested.get("signal_types") or []
    ]

    if signal_payloads_by_id is not None:
        spot_ids: list[str] = []
        perp_ids: list[str] = []
        for signal_id in signal_ids:
            signal_payload = signal_payloads_by_id.get(signal_id)
            if not signal_payload:
                continue
            normalized = normalize_signal_payload(signal_payload)
            lane = normalized.get("evidence_lane")
            if lane == "spot":
                spot_ids.append(signal_id)
            elif lane == "perp":
                perp_ids.append(signal_id)
        nested["spot_signal_ids"] = spot_ids
        nested["perp_signal_ids"] = perp_ids
    else:
        nested.setdefault("spot_signal_ids", nested.get("spot_signal_ids") or [])
        nested.setdefault("perp_signal_ids", nested.get("perp_signal_ids") or [])

    data["payload"] = nested
    return data


def _first_quant_bias_id(
    signal_ids: list[str],
    signal_payloads_by_id: dict[str, dict[str, Any]] | None,
) -> str | None:
    if not signal_payloads_by_id:
        return signal_ids[0] if signal_ids else None
    for signal_id in signal_ids:
        payload = signal_payloads_by_id.get(signal_id)
        if payload and canonical_signal_type(payload.get("signal_type")) == QUANT_BIAS:
            return signal_id
    return signal_ids[0] if signal_ids else None


def _optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return None
    text = str(value).strip().lower()
    if text in {"1", "true", "yes"}:
        return True
    if text in {"0", "false", "no"}:
        return False
    return None


def _clean(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
