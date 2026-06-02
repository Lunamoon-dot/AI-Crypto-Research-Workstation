"""Trade thesis construction for completed graph states."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from luna_workstation.agents.utils.rating import (
    assert_consistent_ratings,
    ensure_no_conflicting_rating_mentions,
    normalize_rating,
    parse_rating_label,
)
from luna_workstation.agents.utils.thesis_json import (
    extract_trade_thesis_json,
    strip_trade_thesis_json_block,
)
from luna_workstation.domain import (
    ResearchRun,
    Signal,
    ThesisDirection,
    TradeThesis,
    TradeThesisStructuredSummary,
    research_item_texts,
)
from luna_workstation.observability import log_event
from luna_workstation.utils.price_sanity import price_trigger_sanity_notes

logger = logging.getLogger(__name__)

_BULLISH_RATINGS = {"Buy", "Overweight"}
_BEARISH_RATINGS = {"Underweight", "Sell"}
_STABILITY_OVERRIDE_TERMS = (
    "confirmed invalidation",
    "invalidation triggered",
    "invalidated by",
    "structural break confirmed",
    "daily close below",
    "daily close above",
    "closed below",
    "closed above",
    "broke below",
    "broke above",
)
_MTF_ALIGNMENT_RE = re.compile(
    r"\bAlignment\s+Score\s*:\s*(?P<score>\d+(?:\.\d+)?)\s*/\s*100",
    re.IGNORECASE,
)
_MTF_DIRECTION_RE = re.compile(
    r"\b(?P<timeframe>daily|weekly|monthly)\b[^\n]*(?P<direction>bullish|bearish|sideways|neutral)",
    re.IGNORECASE,
)
_TEXT_LIST_SPLIT_RE = re.compile(r"[;\n\u2022]|\band\b|,(?=\s+)", re.IGNORECASE)
_NEWS_CODES_RESCOPED_FOR_SOCIAL = {
    "missing_news_feed",
    "insufficient_news_evidence",
    "missing_primary_source_news",
    "workspace_news_source_unavailable",
}
_SPOT_OPTIONAL_MISSING_CODES = {
    "missing_social_feed",
    "missing_funding_rate",
    "missing_liquidations",
    "missing_onchain_flows",
    "missing_long_short_ratio",
    "exchange_oi_unsupported",
}
_CANONICAL_MACHINE_REASON_CODES = {
    "news_context_insufficient_data",
    "missing_news_feed",
    "insufficient_news_evidence",
    "aggregator_only_news",
    "search_only_news",
    "stale_news_window",
    "workspace_news_source_unavailable",
    "low_relevance_news",
    "conflicting_news_sources",
    "no_material_news_found",
    "single_source_concentration",
    "missing_social_feed",
    "missing_onchain_flows",
    "missing_liquidations",
    "missing_funding_rate",
    "missing_long_short_ratio",
    "exchange_oi_unsupported",
    "ohlcv_unavailable",
    "symbol_invalid",
    "market_snapshot_unavailable",
    "thesis_row_missing",
    "run_events_unavailable",
}
_DEGRADATION_MACHINE_REASON_CODES = {
    "news_context_insufficient_data",
    "missing_news_feed",
    "insufficient_news_evidence",
    "aggregator_only_news",
    "search_only_news",
    "stale_news_window",
    "workspace_news_source_unavailable",
    "low_relevance_news",
    "conflicting_news_sources",
    "single_source_concentration",
    "ohlcv_unavailable",
    "symbol_invalid",
    "market_snapshot_unavailable",
    "thesis_row_missing",
    "run_events_unavailable",
}
_NOISY_MACHINE_REASON_CODES = {
    "0",
    "data",
    "missing_data",
    "missing_no_data",
    "missing_unavailable",
    "missing_none",
    "missing_evidence",
    "missing_missing_data",
    "missing_missing_evidence",
    "missing_explicit_label",
    "missing_data_quality",
    "missing_data_conflicts",
    "data_quality",
    "supporting_evidence",
    "text",
    "no_data",
    "unavailable",
    "none",
    "missing_primary_source_news",
}


def extract_thesis_field(text: str, field: str) -> str | None:
    pattern = (
        rf"(\*{{0,2}}{field}\s*(?:Zones?|Levels?|Prices?)?\*{{0,2}}\s*:?\s*)"
        r"(.+?)(?:\n|$)"
    )
    match = re.search(pattern, text, re.IGNORECASE)
    return match.group(2).strip() if match else None


def extract_thesis_list_field(text: str, field: str) -> list[str]:
    value = extract_thesis_field(text, field)
    if not value:
        return []
    parts = _TEXT_LIST_SPLIT_RE.split(value)
    return [p.strip() for p in parts if p.strip()]


def first_nonempty_line(text: str) -> str:
    for line in (text or "").splitlines():
        clean = line.strip(" -*#\t")
        if clean:
            return clean[:500]
    return ""


def signal_evidence(signals: list[Signal], signal_ids: list[str]) -> list[str]:
    wanted = set(signal_ids)
    evidence: list[str] = []
    for signal in signals:
        if not signal.id or signal.id not in wanted:
            continue
        detail = signal.summary or str(signal.evidence.get("detail") or "")
        if not detail:
            detail = f"{signal.signal_type}: {signal.direction.value}"
        evidence.append(detail[:500])
    return evidence


def stale_or_missing_data_notes(signals: list[Signal]) -> list[str]:
    notes: list[str] = []
    for signal in signals:
        freshness = getattr(
            signal.provenance.freshness,
            "value",
            signal.provenance.freshness,
        )
        if freshness in ("stale", "unknown"):
            notes.append(f"{signal.signal_type}: {freshness}")
    return notes


def parse_structured_summary_payload(raw_json: str | None) -> dict[str, Any]:
    if not raw_json:
        return {}
    raw = raw_json.strip()
    object_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if object_match:
        raw = object_match.group(0)
    candidates = [raw, re.sub(r",(\s*[}\]])", r"\1", raw)]
    for candidate in candidates:
        try:
            loaded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(loaded, dict):
            return loaded
    return {}


def summary_rating(payload: dict[str, Any]) -> str | None:
    raw = payload.get("rating")
    return normalize_rating(raw) if raw is not None else None


def summary_direction(payload: dict[str, Any]) -> ThesisDirection | None:
    aliases = {
        "long": ThesisDirection.LONG,
        "buy": ThesisDirection.LONG,
        "bullish": ThesisDirection.LONG,
        "short": ThesisDirection.SHORT,
        "sell": ThesisDirection.SHORT,
        "bearish": ThesisDirection.SHORT,
        "watch": ThesisDirection.WATCH,
        "hold": ThesisDirection.WATCH,
        "avoid": ThesisDirection.AVOID,
        "neutral": ThesisDirection.NEUTRAL,
    }
    raw = payload.get("direction")
    return aliases.get(str(raw).strip().lower()) if raw is not None else None


def structured_text(payload: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def structured_list(payload: dict[str, Any], *keys: str) -> list[str]:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            parts = _TEXT_LIST_SPLIT_RE.split(value)
            return [part.strip() for part in parts if part.strip()]
        if isinstance(value, (list, tuple)):
            return [str(part).strip() for part in value if str(part).strip()]
        text = str(value).strip()
        return [text] if text else []
    return []


def text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        value = list(value) if isinstance(value, tuple) else [value]
    return [str(item).strip() for item in value if str(item).strip()]


def structured_item_text_list(value: Any) -> list[str]:
    return [text[:500] for text in research_item_texts(value)]


def merge_structured_items(value: Any, additions: list[str]) -> list[Any]:
    values = value if isinstance(value, list) else ([] if value is None else [value])
    result: list[Any] = []
    seen: set[str] = set()
    for item in values:
        texts = structured_item_text_list(item)
        text = texts[0] if texts else ""
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(item)
    for text in additions:
        clean = str(text or "").strip()
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean[:500])
    return result


def normalize_confidence_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        raw = value.strip()
        is_percent = raw.endswith("%")
        raw = raw.rstrip("%").strip()
        try:
            number = float(raw)
        except ValueError:
            return None
        if is_percent or number > 1:
            number = number / 100
        return max(min(number, 1.0), 0.0)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(min(number, 1.0), 0.0)


def normalize_price_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").strip().lstrip("$"))
    except (TypeError, ValueError):
        return None


def quant_bias_from_score(score: Any) -> str:
    value = getattr(score, "value", score)
    normalized = str(value or "").strip().lower()
    if "buy" in normalized:
        return "bullish"
    if "sell" in normalized:
        return "bearish"
    if "neutral" in normalized:
        return "neutral"
    return "unknown"


def thesis_bias_from_direction(direction: ThesisDirection) -> str:
    if direction == ThesisDirection.LONG:
        return "bullish"
    if direction in {ThesisDirection.SHORT, ThesisDirection.AVOID}:
        return "bearish"
    if direction in {ThesisDirection.WATCH, ThesisDirection.NEUTRAL}:
        return "neutral"
    return "unknown"


def rating_bias(rating: str | None) -> str:
    normalized = summary_rating({"rating": rating}) if rating is not None else None
    if normalized in _BULLISH_RATINGS:
        return "bullish"
    if normalized in _BEARISH_RATINGS:
        return "bearish"
    if normalized == "Hold":
        return "neutral"
    return "unknown"


def direction_from_rating(rating: str | None) -> ThesisDirection:
    normalized = summary_rating({"rating": rating}) if rating is not None else None
    if normalized in _BULLISH_RATINGS:
        return ThesisDirection.LONG
    if normalized == "Sell":
        return ThesisDirection.SHORT
    if normalized == "Underweight":
        return ThesisDirection.AVOID
    return ThesisDirection.WATCH


def thesis_rating(thesis: TradeThesis) -> str:
    if thesis.structured_summary is not None:
        return thesis.structured_summary.rating
    return {
        ThesisDirection.LONG: "Overweight",
        ThesisDirection.SHORT: "Underweight",
        ThesisDirection.AVOID: "Underweight",
        ThesisDirection.NEUTRAL: "Hold",
        ThesisDirection.WATCH: "Hold",
    }.get(thesis.direction, "Hold")


def utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _dedupe(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _machine_reason_codes(values: list[Any]) -> list[str]:
    codes: list[str] = []
    for value in values:
        code = _canonical_machine_reason_code(_reason_code(value))
        if code:
            codes.append(code)
    return _dedupe(codes)


def _canonical_machine_reason_code(code: str) -> str | None:
    if not code or code in _NOISY_MACHINE_REASON_CODES:
        return None
    if code.startswith("single_source_concentration"):
        return "single_source_concentration"
    if code == "missing_workspace_sources_and_targeted_search":
        return "workspace_news_source_unavailable"
    if code == "missing_primary_source_crypto_headlines":
        return "insufficient_news_evidence"
    if "missing_polarity_data" in code or (
        "polarity" in code and ("sentiment" in code or "social" in code)
    ):
        return "missing_social_feed"
    if code in _CANONICAL_MACHINE_REASON_CODES:
        return code
    if code.startswith(("cross_venue_", "signal_factor_", "missing_template_")):
        return code
    return None


def _visible_degradation_reason_codes(
    values: list[Any],
    *,
    optional_missing_codes: set[str],
) -> list[str]:
    codes: list[str] = []
    for code in _machine_reason_codes(values):
        if code in optional_missing_codes:
            continue
        if code in _DEGRADATION_MACHINE_REASON_CODES or code.startswith(
            ("cross_venue_", "signal_factor_", "missing_template_")
        ):
            codes.append(code)
    return _dedupe(codes)


def _opinion_values(opinions: list[Any], attr: str) -> list[str]:
    values: list[Any] = []
    for opinion in opinions:
        values.extend(text_list(getattr(opinion, attr, None)))
    return _dedupe(values)


def _opinion_scoped_reason_values(opinions: list[Any], attr: str) -> list[str]:
    values: list[str] = []
    for opinion in opinions:
        for value in text_list(getattr(opinion, attr, None)):
            code = _reason_code(value)
            if _is_social_opinion(opinion) and code in _NEWS_CODES_RESCOPED_FOR_SOCIAL:
                code = "missing_social_feed"
            values.append(code)
    return _dedupe(values)


def _news_opinion_machine_codes(opinions: list[Any]) -> list[str]:
    values: list[Any] = []
    for opinion in opinions:
        if not _is_news_opinion(opinion):
            continue
        values.extend(text_list(getattr(opinion, "reason_codes", None)))
        values.extend(text_list(getattr(opinion, "missing_data", None)))
    return _machine_reason_codes(values)


def _is_news_opinion(opinion: Any) -> bool:
    source = str(getattr(opinion, "source_report_type", "") or "").lower()
    role = str(getattr(opinion, "role", "") or "").lower()
    return source == "news" or role == "news_analyst"


def _is_social_opinion(opinion: Any) -> bool:
    source = str(getattr(opinion, "source_report_type", "") or "").lower()
    role = str(getattr(opinion, "role", "") or "").lower()
    return source in {"sentiment", "social"} or "sentiment" in role or "social" in role


def _has_insufficient_news_context(opinions: list[Any]) -> bool:
    for opinion in opinions:
        if not _is_news_opinion(opinion):
            continue
        text = str(getattr(opinion, "raw_text", "") or "").lower()
        if "pre-computed news context" not in text:
            continue
        if "quality: insufficient_data" in text or "quality: insufficient" in text:
            return True
    return False


def _optional_missing_codes(
    run: ResearchRun | None,
    payload: dict[str, Any],
) -> set[str]:
    raw_market_type = payload.get("market_type") or (
        getattr(run, "market_type", "spot") if run else "spot"
    )
    market_type = str(raw_market_type or "spot").lower()
    return (
        _SPOT_OPTIONAL_MISSING_CODES
        if market_type == "spot"
        else {"missing_social_feed"}
    )


def _reason_code(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.split(":", 1)[0] if ":" in text else text
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    if "third_party_crypto_news_feed" in text:
        return "missing_news_feed"
    if "news_feed" in text and any(
        term in text for term in ("missing", "no", "unsupported", "unavailable")
    ):
        return "missing_news_feed"
    if text.startswith("single_source_concentration"):
        return "single_source_concentration"
    if "workspace_sources" in text and "targeted_search" in text:
        return "workspace_news_source_unavailable"
    if "primary_source_crypto_headlines" in text:
        return "insufficient_news_evidence"
    if "missing_polarity_data" in text or (
        "polarity" in text and ("sentiment" in text or "social" in text)
    ):
        return "missing_social_feed"
    aliases = {
        "news": "missing_news_feed",
        "missing_news": "missing_news_feed",
        "missing_news_feed": "missing_news_feed",
        "missing_primary_source_news": "missing_primary_source_news",
        "news_context_insufficient_data": "news_context_insufficient_data",
        "insufficient_news_evidence": "insufficient_news_evidence",
        "aggregator_only_news": "aggregator_only_news",
        "search_only_news": "search_only_news",
        "stale_news_window": "stale_news_window",
        "workspace_news_source_unavailable": "workspace_news_source_unavailable",
        "low_relevance_news": "low_relevance_news",
        "conflicting_news_sources": "conflicting_news_sources",
        "single_source_concentration": "single_source_concentration",
        "social": "missing_social_feed",
        "missing_social": "missing_social_feed",
        "missing_social_feed": "missing_social_feed",
        "liquidation": "missing_liquidations",
        "liquidations": "missing_liquidations",
        "missing_liquidations": "missing_liquidations",
        "funding_rate": "missing_funding_rate",
        "funding_rate_history": "missing_funding_rate",
        "missing_funding_rate": "missing_funding_rate",
        "open_interest": "exchange_oi_unsupported",
        "open_interest_history": "exchange_oi_unsupported",
        "exchange_oi_unsupported": "exchange_oi_unsupported",
        "onchain": "missing_onchain_flows",
        "on_chain": "missing_onchain_flows",
        "onchain_secondary": "missing_onchain_flows",
        "missing_onchain_secondary": "missing_onchain_flows",
        "missing_onchain_flows": "missing_onchain_flows",
    }
    if "liquidation" in text:
        return "missing_liquidations"
    if "onchain" in text or "on_chain" in text or "exchange_flow" in text:
        return "missing_onchain_flows"
    return aliases.get(text, text or "unknown_data_quality_issue")


def _format_percent(value: float) -> str:
    return f"{value:.0%}"


def _format_alignment_score(value: float) -> str:
    return f"{value:.0f}/100"


def _normalized_mtf_direction(value: str) -> str:
    normalized = value.lower()
    return "neutral" if normalized == "sideways" else normalized


def _mtf_penalty_from_state(
    final_state: dict, thesis_text: str
) -> tuple[float, str, dict[str, Any]]:
    """Return a deterministic confidence penalty for mixed timeframe evidence."""

    text = "\n".join(
        str(part or "")
        for part in [
            final_state.get("market_report", ""),
            final_state.get("trader_investment_plan", ""),
            final_state.get("scenario_plan", ""),
            thesis_text,
        ]
    )
    score_match = _MTF_ALIGNMENT_RE.search(text)
    if not score_match:
        return 0.0, "", {}

    score = max(min(float(score_match.group("score")), 100.0), 0.0)
    directions: dict[str, str] = {}
    for match in _MTF_DIRECTION_RE.finditer(text):
        timeframe = match.group("timeframe").lower()
        directions.setdefault(
            timeframe,
            _normalized_mtf_direction(match.group("direction")),
        )

    penalty = 0.0
    if score < 40:
        penalty = 0.20
    elif score < 60:
        penalty = 0.10
    elif score < 70:
        penalty = 0.05

    daily = directions.get("daily")
    monthly = directions.get("monthly")
    if daily and monthly and daily != monthly and score < 70:
        penalty = max(penalty, 0.10)

    if penalty <= 0:
        return (
            0.0,
            "",
            {
                "alignment_score": score,
                "directions": directions,
                "penalty": 0.0,
            },
        )

    direction_note = ""
    if directions:
        ordered = [
            f"{timeframe} {directions[timeframe]}"
            for timeframe in ("daily", "weekly", "monthly")
            if timeframe in directions
        ]
        direction_note = f" ({', '.join(ordered)})"

    note = (
        "Multi-timeframe alignment "
        f"{_format_alignment_score(score)}{direction_note}; confidence reduced "
        f"by {_format_percent(penalty)}."
    )
    return (
        penalty,
        note,
        {
            "alignment_score": score,
            "directions": directions,
            "penalty": penalty,
        },
    )


class ThesisBuilder:
    """Builds journal ``TradeThesis`` artifacts from graph output."""

    def __init__(self, host: Any):
        self.host = host

    def build(self, final_state: dict) -> TradeThesis:
        final_decision = final_state.get("final_trade_decision", "")
        raw_summary_json = final_state.get("final_trade_summary_json") or (
            extract_trade_thesis_json(final_decision)
        )
        structured_payload = parse_structured_summary_payload(raw_summary_json)
        clean_decision = (
            strip_trade_thesis_json_block(final_decision)
            if raw_summary_json
            else final_decision
        ) or final_decision

        run: ResearchRun | None = getattr(self.host, "current_research_run", None)
        market_type = (
            structured_payload.get("market_type")
            or final_state.get("market_type")
            or getattr(run, "market_type", None)
            or (getattr(self.host, "config", None) or {}).get("market_type", "spot")
        )
        rating = assert_consistent_ratings(
            [
                ("structured_summary.rating", summary_rating(structured_payload)),
                ("final_trade_decision.rating", parse_rating_label(clean_decision)),
                ("final_signal", final_state.get("final_signal")),
            ],
            context="trade thesis",
        ) or self.host.process_signal(clean_decision)
        ensure_no_conflicting_rating_mentions(
            clean_decision,
            official_rating=rating,
            context="final_trade_decision",
        )
        direction = self._resolve_direction(
            rating=rating,
            requested_direction=summary_direction(structured_payload),
            market_type=str(market_type),
        )

        quant = getattr(self.host, "quant_signal_result", None)
        structured_confidence = normalize_confidence_value(
            structured_payload.get("confidence")
        )
        quant_confidence = normalize_confidence_value(
            getattr(quant, "confidence", None) if quant is not None else None
        )
        empirical_confidence = (
            getattr(quant, "empirical_confidence", None) if quant is not None else None
        )
        empirical_sample_size = (
            int(getattr(quant, "empirical_sample_size", 0) or 0)
            if quant is not None
            else 0
        )
        empirical_oos_sample_size = (
            int(getattr(quant, "empirical_oos_sample_size", 0) or 0)
            if quant is not None
            else 0
        )
        confidence_version = (
            str(getattr(quant, "signal_weight_version", "") or "heuristic:v1")
            if quant is not None
            else "heuristic:v1"
        )

        debate = getattr(self.host, "current_debate", None)
        debate_id = getattr(debate, "id", None) if debate else None
        supporting_ids, contradicting_ids = self.host._classify_thesis_signals(
            direction
        )
        opinions = getattr(self.host, "current_agent_opinions", []) or []
        opinion_ids = [o.id for o in opinions if o.id]

        entry_zone = structured_text(
            structured_payload,
            "entry_zone",
            "entry",
            "entry_level",
            "entry_price",
        )
        confirmation_condition = structured_text(
            structured_payload,
            "confirmation_condition",
            "confirmation",
            "confirm_condition",
            "validation_condition",
            "validation_trigger",
        )
        invalidation_level = structured_text(
            structured_payload,
            "invalidation_level",
            "invalidation",
            "stop_loss",
            "stop",
        )
        target_zones = structured_list(
            structured_payload,
            "target_zones",
            "targets",
            "target",
            "take_profit",
            "take_profit_zones",
        )
        current_price = normalize_price_value(
            getattr(quant, "current_price", None) if quant is not None else None
        )
        contract_degradation_reasons: list[str] = []
        if not structured_payload:
            contract_degradation_reasons.append("structured_summary_missing")
        if not entry_zone:
            prose_entry = extract_thesis_field(clean_decision, "entry")
            if prose_entry:
                entry_zone = prose_entry
                contract_degradation_reasons.append("entry_zone_from_prose")
        if not confirmation_condition:
            prose_confirmation = extract_thesis_field(
                clean_decision, "confirmation"
            ) or extract_thesis_field(clean_decision, "validation")
            if prose_confirmation:
                confirmation_condition = prose_confirmation
                contract_degradation_reasons.append("confirmation_condition_from_prose")
        if not invalidation_level:
            prose_invalidation = extract_thesis_field(clean_decision, "invalidation")
            if prose_invalidation:
                invalidation_level = prose_invalidation
                contract_degradation_reasons.append("invalidation_from_prose")
        if not target_zones:
            prose_targets = extract_thesis_list_field(clean_decision, "target")
            if prose_targets:
                target_zones = prose_targets
                contract_degradation_reasons.append("target_zones_from_prose")

        for field_name, value in (
            ("entry_zone", entry_zone),
            ("confirmation_condition", confirmation_condition),
            ("invalidation", invalidation_level),
            ("target_zones", target_zones),
        ):
            if not value:
                contract_degradation_reasons.append(
                    f"{field_name}_missing_from_structured_summary"
                )

        contradictions = getattr(debate, "contradictions", None) or []
        consensus = getattr(debate, "consensus", None) or {}
        signals = getattr(self.host, "current_signals", []) or []
        supporting_evidence = signal_evidence(signals, supporting_ids)
        contradicting_evidence = signal_evidence(signals, contradicting_ids)
        stale_or_missing_data = stale_or_missing_data_notes(signals)
        opinion_missing_data = _opinion_values(opinions, "missing_data")
        summary_missing_data = _dedupe(
            [
                *structured_list(structured_payload, "missing_data"),
                *stale_or_missing_data,
                *opinion_missing_data,
            ]
        )[:10]
        price_sanity_text = "\n".join(
            str(part or "")
            for part in [
                entry_zone,
                confirmation_condition,
                invalidation_level,
                *[f"upside target {target}" for target in target_zones],
                structured_payload.get("upside_catalyst"),
                clean_decision,
            ]
        )
        price_sanity_notes = price_trigger_sanity_notes(
            price_sanity_text,
            current_price,
            source="thesis",
        )
        data_quality, data_quality_label, missing_data_reason_codes = (
            self._derive_data_quality(
                run=run,
                signals=signals,
                opinions=opinions,
                stale_or_missing_data=stale_or_missing_data,
                contract_degradation_reasons=contract_degradation_reasons,
                payload=structured_payload,
            )
        )
        run_degradation_reasons = list(
            getattr(run, "degradation_reasons", []) if run else []
        )
        optional_missing_codes = _optional_missing_codes(run, structured_payload)
        all_degradation_reasons = _dedupe(
            [
                *contract_degradation_reasons,
                *_visible_degradation_reason_codes(
                    run_degradation_reasons,
                    optional_missing_codes=optional_missing_codes,
                ),
                *_visible_degradation_reason_codes(
                    missing_data_reason_codes,
                    optional_missing_codes=optional_missing_codes,
                ),
            ]
        )
        why_this_thesis = first_nonempty_line(clean_decision) or (
            f"{direction.value} thesis generated from agent debate"
        )
        monitor_next = [
            item
            for item in [
                *structured_item_text_list(structured_payload.get("monitor_next")),
                f"entry: {entry_zone}" if entry_zone else "",
                (
                    f"confirmation: {confirmation_condition}"
                    if confirmation_condition
                    else ""
                ),
                f"invalidation: {invalidation_level}" if invalidation_level else "",
                *[f"target: {target}" for target in target_zones],
            ]
            if item
        ]
        confidence, confidence_source = self._derive_final_confidence(
            structured_confidence=structured_confidence,
            quant_confidence=quant_confidence,
            quant_score=getattr(quant, "score", None) if quant is not None else None,
            debate=debate,
            opinions=opinions,
            direction=direction,
            stale_or_missing_count=len(stale_or_missing_data),
            contract_degradation_count=len(contract_degradation_reasons),
        )
        confidence, confidence_source, confidence_cap_note = (
            self._apply_data_quality_confidence_cap(
                confidence=confidence,
                confidence_source=confidence_source,
                data_quality_label=data_quality_label,
            )
        )
        confidence, confidence_source, quant_cap_note = (
            self._apply_low_quant_confidence_cap(
                confidence=confidence,
                confidence_source=confidence_source,
                quant_confidence=quant_confidence,
            )
        )
        mtf_penalty, mtf_penalty_note, mtf_penalty_payload = _mtf_penalty_from_state(
            final_state,
            clean_decision,
        )
        confidence, confidence_source = self._apply_confidence_penalty(
            confidence=confidence,
            confidence_source=confidence_source,
            penalty=mtf_penalty,
            suffix="mtf_penalized",
        )
        system_risk_notes = _dedupe(
            [
                *price_sanity_notes,
                confidence_cap_note,
                quant_cap_note,
                mtf_penalty_note,
            ]
        )
        heuristic_confidence = confidence
        if confidence_source != "quant_only":
            confidence_version = "thesis_heuristic:v1"
        confidence_rationale = self._confidence_rationale(
            confidence,
            confidence_source,
            quant_confidence,
            quant_bias_from_score(
                getattr(quant, "score", None) if quant is not None else None
            ),
            supporting_ids,
            contradicting_ids,
        )
        for note in [confidence_cap_note, quant_cap_note, mtf_penalty_note]:
            if note:
                confidence_rationale = f"{confidence_rationale} {note}"
        structured_summary = self._structured_summary(
            payload=structured_payload,
            rating=rating,
            direction=direction,
            confidence=confidence,
            thesis_text=clean_decision,
            entry_zone=entry_zone,
            confirmation_condition=confirmation_condition,
            invalidation_level=invalidation_level,
            target_zones=target_zones,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            contradictions=contradictions,
            why_this_thesis=why_this_thesis,
            monitor_next=monitor_next,
            contract_degradation_reasons=all_degradation_reasons,
            market_type=market_type,
            missing_data=summary_missing_data,
            data_quality=data_quality,
            data_quality_label=data_quality_label,
            missing_data_reason_codes=missing_data_reason_codes,
            system_risk_notes=system_risk_notes,
        )

        thesis = TradeThesis(
            id=str(uuid.uuid4()),
            workspace_id=getattr(run, "workspace_id", "local"),
            symbol=getattr(self.host, "ticker", None)
            or final_state.get("company_of_interest", ""),
            direction=direction,
            setup_type="agent_debate",
            structured_summary=structured_summary,
            thesis_text=clean_decision,
            confidence=confidence,
            heuristic_confidence=heuristic_confidence,
            empirical_confidence=empirical_confidence,
            empirical_confidence_sample_size=empirical_sample_size,
            empirical_confidence_oos_sample_size=empirical_oos_sample_size,
            confidence_version=confidence_version,
            debate_id=debate_id,
            supporting_signal_ids=supporting_ids,
            contradicting_signal_ids=contradicting_ids,
            agent_opinion_ids=opinion_ids,
            entry_zone=entry_zone,
            confirmation_condition=confirmation_condition or "",
            invalidation_level=invalidation_level,
            target_zones=target_zones,
            contradictions=contradictions,
            consensus=consensus,
            evidence={
                "signals_supporting": len(supporting_ids),
                "signals_contradicting": len(contradicting_ids),
                "opinions_linked": len(opinion_ids),
                "debate_linked": debate_id is not None,
                "structured_summary": bool(structured_payload),
                "contract_degraded": bool(contract_degradation_reasons),
                "contract_degradation_reasons": contract_degradation_reasons,
                "confidence_source": confidence_source,
                "quant_confidence": quant_confidence,
                "quant_bias": quant_bias_from_score(
                    getattr(quant, "score", None) if quant is not None else None
                ),
                "data_quality": data_quality,
                "data_quality_label": data_quality_label,
                "missing_data_reason_codes": missing_data_reason_codes,
                "current_price": current_price,
                "price_sanity_notes": price_sanity_notes,
                "mtf_confidence_penalty": mtf_penalty_payload,
            },
            why_this_thesis=why_this_thesis,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            invalidation=invalidation_level or "",
            monitor_next=monitor_next,
            confidence_rationale=confidence_rationale,
            risk_notes=structured_item_text_list(structured_summary.risks)
            or ["Manual review required before changing thesis stance."],
        )

        thesis = self._apply_stability_guard(thesis)
        thesis = self._refresh_price_sanity_notes(thesis)

        if run and not run.decision_id:
            run.decision_id = str(uuid.uuid4())

        log_event(
            logger,
            "thesis_generated",
            run_id=getattr(run, "id", None),
            thesis_id=thesis.id,
            symbol=getattr(self.host, "ticker", None),
            thesis_direction=thesis.direction.value,
            confidence=thesis.confidence,
            heuristic_confidence=thesis.heuristic_confidence,
            empirical_confidence=thesis.empirical_confidence,
            empirical_confidence_sample_size=thesis.empirical_confidence_sample_size,
            empirical_confidence_oos_sample_size=thesis.empirical_confidence_oos_sample_size,
            confidence_version=thesis.confidence_version,
            data_quality=data_quality,
            data_quality_label=data_quality_label,
            supporting_evidence_count=len(thesis.supporting_evidence),
            contradicting_evidence_count=len(thesis.contradicting_evidence),
            stale_or_missing_data_count=len(thesis.stale_or_missing_data),
        )
        log_event(
            logger,
            "decision_created",
            run_id=getattr(run, "id", None),
            decision_id=getattr(run, "decision_id", None),
            symbol=getattr(self.host, "ticker", None),
            thesis_id=thesis.id,
            thesis_direction=thesis.direction.value,
            setup_type=thesis.setup_type,
            confidence=thesis.confidence,
            heuristic_confidence=thesis.heuristic_confidence,
            empirical_confidence=thesis.empirical_confidence,
            confidence_version=thesis.confidence_version,
            data_quality=data_quality,
            data_quality_label=data_quality_label,
        )
        return thesis

    @staticmethod
    def _resolve_direction(
        *,
        rating: str,
        requested_direction: ThesisDirection | None,
        market_type: str,
    ) -> ThesisDirection:
        """Resolve thesis direction from the official rating contract."""

        expected = direction_from_rating(rating)
        if rating == "Underweight":
            return ThesisDirection.AVOID
        if rating == "Sell":
            return ThesisDirection.SHORT
        if rating in _BULLISH_RATINGS:
            return ThesisDirection.LONG
        if requested_direction in {ThesisDirection.NEUTRAL, ThesisDirection.WATCH}:
            return requested_direction
        return expected

    @staticmethod
    def _derive_data_quality(
        *,
        run: ResearchRun | None,
        signals: list[Signal],
        opinions: list[Any],
        stale_or_missing_data: list[str],
        contract_degradation_reasons: list[str],
        payload: dict[str, Any],
    ) -> tuple[float, str, list[str]]:
        run_degradation = list(getattr(run, "degradation_reasons", []) if run else [])
        run_missing_optional = list(
            getattr(run, "missing_optional_data", []) if run else []
        )
        run_missing_core = list(getattr(run, "missing_core_data", []) if run else [])
        optional_missing_codes = _optional_missing_codes(run, payload)
        opinion_reason_codes = _opinion_scoped_reason_values(opinions, "reason_codes")
        opinion_missing_data = _opinion_scoped_reason_values(opinions, "missing_data")
        reason_codes = _dedupe(
            [
                *structured_list(payload, "missing_data_reason_codes", "reason_codes"),
                *structured_list(payload, "missing_data"),
                *opinion_reason_codes,
                *opinion_missing_data,
                *run_degradation,
                *run_missing_optional,
                *run_missing_core,
                *contract_degradation_reasons,
                *stale_or_missing_data,
            ]
        )
        signal_quality_candidates = [
            normalize_confidence_value(signal.evidence.get("data_quality"))
            for signal in signals
            if isinstance(getattr(signal, "evidence", None), dict)
            and signal.evidence.get("data_quality") is not None
        ]
        signal_quality_values = [
            value for value in signal_quality_candidates if value is not None
        ]
        opinion_quality_candidates = [
            normalize_confidence_value(getattr(opinion, "data_quality", None))
            for opinion in opinions
        ]
        opinion_quality_values = [
            value for value in opinion_quality_candidates if value is not None
        ]

        quality = 1.0
        if signal_quality_values:
            quality = min(
                quality, sum(signal_quality_values) / len(signal_quality_values)
            )
        if opinion_quality_values:
            quality = min(
                quality, sum(opinion_quality_values) / len(opinion_quality_values)
            )
        run_degradation_codes = _machine_reason_codes(
            [*run_degradation, *run_missing_optional]
        )
        non_optional_run_degradation = any(
            code not in optional_missing_codes for code in run_degradation_codes
        )
        run_status = getattr(
            getattr(run, "status", ""), "value", getattr(run, "status", "")
        )
        if run and str(run_status) == "completed_degraded":
            non_optional_run_degradation = non_optional_run_degradation or not (
                run_degradation_codes
            )

        if run and run.missing_core_data:
            quality = min(quality, 0.25)
        elif run and run.has_degradation() and non_optional_run_degradation:
            quality = min(quality, 0.6)
        if contract_degradation_reasons:
            quality = min(quality, 0.65)
        if stale_or_missing_data:
            quality -= min(0.05 * len(stale_or_missing_data), 0.20)
        machine_codes = _machine_reason_codes(reason_codes)
        opinion_machine_codes = _machine_reason_codes(
            [*opinion_reason_codes, *opinion_missing_data]
        )
        news_opinion_machine_codes = _news_opinion_machine_codes(opinions)
        if (
            "news_context_insufficient_data" in machine_codes
            or _has_insufficient_news_context(opinions)
            or "insufficient_news_evidence" in news_opinion_machine_codes
        ):
            quality = min(quality, 0.34)
        if (
            "missing_onchain_flows" in opinion_machine_codes
            or "insufficient_onchain_evidence" in opinion_machine_codes
        ) and "missing_onchain_flows" not in optional_missing_codes:
            quality = min(quality, 0.6)
        if any(
            item.startswith("missing_") and item not in optional_missing_codes
            for item in machine_codes
        ):
            quality = min(quality, 0.6)

        quality = round(max(min(quality, 1.0), 0.0), 2)
        if quality < 0.35:
            label = "insufficient_data"
        elif quality < 0.75:
            label = "degraded"
        else:
            label = "clean"
        return quality, label, machine_codes

    @staticmethod
    def _apply_data_quality_confidence_cap(
        *,
        confidence: float | None,
        confidence_source: str,
        data_quality_label: str,
    ) -> tuple[float | None, str, str]:
        cap_by_label = {
            "insufficient_data": 0.25,
            "degraded": 0.45,
        }
        cap = cap_by_label.get(data_quality_label)
        if cap is None or confidence is None or confidence <= cap:
            return confidence, confidence_source, ""
        return (
            round(cap, 2),
            f"{confidence_source}_data_quality_capped",
            (
                f"Data quality is {data_quality_label}; final confidence capped "
                f"at {cap:.0%} and should be treated as a low-confidence risk memo."
            ),
        )

    @staticmethod
    def _apply_low_quant_confidence_cap(
        *,
        confidence: float | None,
        confidence_source: str,
        quant_confidence: float | None,
    ) -> tuple[float | None, str, str]:
        if (
            confidence is None
            or quant_confidence is None
            or quant_confidence > 0.25
            or "portfolio_manager" not in confidence_source
        ):
            return confidence, confidence_source, ""

        cap = min(0.25, round(quant_confidence + 0.10, 2))
        if confidence <= cap:
            return confidence, confidence_source, ""
        return (
            cap,
            f"{confidence_source}_low_quant_capped",
            (
                f"Quant heuristic confidence is {quant_confidence:.0%}; final "
                f"confidence capped at {cap:.0%} and should be treated as a "
                "watch/risk memo."
            ),
        )

    @staticmethod
    def _apply_confidence_penalty(
        *,
        confidence: float | None,
        confidence_source: str,
        penalty: float,
        suffix: str,
    ) -> tuple[float | None, str]:
        if confidence is None or penalty <= 0:
            return confidence, confidence_source
        return round(max(confidence - penalty, 0.0), 2), f"{confidence_source}_{suffix}"

    @staticmethod
    def _refresh_price_sanity_notes(thesis: TradeThesis) -> TradeThesis:
        current_price = normalize_price_value(thesis.evidence.get("current_price"))
        text = "\n".join(
            str(part or "")
            for part in [
                thesis.entry_zone,
                thesis.confirmation_condition,
                thesis.invalidation_level,
                *[f"upside target {target}" for target in thesis.target_zones],
                thesis.invalidation,
                thesis.thesis_text,
            ]
        )
        notes = price_trigger_sanity_notes(text, current_price, source="thesis")
        if not notes:
            return thesis

        all_notes = _dedupe(
            [
                *list(thesis.evidence.get("price_sanity_notes", []) or []),
                *notes,
            ]
        )
        thesis.evidence["price_sanity_notes"] = all_notes
        thesis.risk_notes = _dedupe([*thesis.risk_notes, *all_notes])
        if thesis.structured_summary is not None:
            thesis.structured_summary = thesis.structured_summary.model_copy(
                update={
                    "risks": merge_structured_items(
                        thesis.structured_summary.risks,
                        all_notes,
                    )
                }
            )
        return thesis

    def _apply_stability_guard(self, thesis: TradeThesis) -> TradeThesis:
        cfg = (getattr(self.host, "config", None) or {}).get("thesis_stability", {})
        if not cfg.get("enabled", True):
            return thesis

        previous = self._latest_previous_thesis(thesis, cfg)
        if previous is None:
            return thesis

        previous_time = utc_datetime(previous.created_at)
        current_time = utc_datetime(thesis.created_at)
        if previous_time is None or current_time is None:
            return thesis

        age_minutes = (current_time - previous_time).total_seconds() / 60.0
        cooldown_minutes = max(float(cfg.get("cooldown_minutes", 60)), 0.0)
        if age_minutes < 0 or age_minutes > cooldown_minutes:
            return thesis

        previous_rating = thesis_rating(previous)
        proposed_rating = thesis_rating(thesis)
        previous_bias = thesis_bias_from_direction(previous.direction)
        proposed_bias = thesis_bias_from_direction(thesis.direction)
        rating_changed = rating_bias(previous_rating) != rating_bias(proposed_rating)
        direction_changed = previous_bias != proposed_bias

        previous_conf = normalize_confidence_value(previous.confidence)
        proposed_conf = normalize_confidence_value(thesis.confidence)
        max_delta = max(float(cfg.get("max_confidence_delta", 0.20)), 0.0)
        confidence_delta = (
            abs(previous_conf - proposed_conf)
            if previous_conf is not None and proposed_conf is not None
            else 0.0
        )

        if (
            not direction_changed
            and not rating_changed
            and confidence_delta <= max_delta
        ):
            return thesis

        if self._has_stability_override(thesis, cfg):
            thesis.evidence["stability_guard"] = {
                "applied": False,
                "reason": "override_evidence_present",
                "previous_thesis_id": previous.id,
                "previous_direction": previous.direction.value,
                "previous_rating": previous_rating,
                "previous_confidence": previous.confidence,
                "age_minutes": round(age_minutes, 1),
            }
            return thesis

        proposed = {
            "direction": thesis.direction.value,
            "rating": proposed_rating,
            "confidence": thesis.confidence,
            "entry_zone": thesis.entry_zone,
            "confirmation_condition": thesis.confirmation_condition,
            "invalidation_level": thesis.invalidation_level,
            "target_zones": list(thesis.target_zones),
            "action_summary": (
                thesis.structured_summary.action_summary
                if thesis.structured_summary
                else ""
            ),
        }
        reason = (
            f"Stability guard retained previous {previous.direction.value}/"
            f"{previous_rating} thesis from {previous.id} because this rerun "
            f"arrived {age_minutes:.1f} minutes later without override evidence."
        )

        thesis.direction = previous.direction
        thesis.confidence = previous.confidence
        thesis.heuristic_confidence = previous.heuristic_confidence
        thesis.entry_zone = previous.entry_zone
        thesis.confirmation_condition = previous.confirmation_condition
        thesis.invalidation_level = previous.invalidation_level
        thesis.invalidation = previous.invalidation
        thesis.target_zones = list(previous.target_zones)
        thesis.monitor_next = list(previous.monitor_next)

        if previous.structured_summary is not None:
            thesis.structured_summary = previous.structured_summary.model_copy(
                update={
                    "rating": previous_rating,
                    "direction": previous.direction,
                    "confidence": previous.confidence,
                    "is_degraded": bool(
                        getattr(previous.structured_summary, "is_degraded", False)
                    ),
                    "degradation_reasons": list(
                        getattr(
                            previous.structured_summary,
                            "degradation_reasons",
                            [],
                        )
                    ),
                }
            )
        elif thesis.structured_summary is not None:
            thesis.structured_summary = thesis.structured_summary.model_copy(
                update={
                    "rating": previous_rating,
                    "direction": previous.direction,
                    "confidence": previous.confidence,
                    "entry_zone": previous.entry_zone or "",
                    "confirmation_condition": previous.confirmation_condition or "",
                    "invalidation": previous.invalidation or "",
                    "target_zones": list(previous.target_zones),
                }
            )

        supporting_ids, contradicting_ids = self.host._classify_thesis_signals(
            thesis.direction
        )
        signals = getattr(self.host, "current_signals", []) or []
        thesis.supporting_signal_ids = supporting_ids
        thesis.contradicting_signal_ids = contradicting_ids
        thesis.supporting_evidence = signal_evidence(signals, supporting_ids)
        thesis.contradicting_evidence = signal_evidence(signals, contradicting_ids)
        thesis.evidence.update(
            {
                "signals_supporting": len(supporting_ids),
                "signals_contradicting": len(contradicting_ids),
                "stability_guard": {
                    "applied": True,
                    "reason": "cooldown_without_override",
                    "previous_thesis_id": previous.id,
                    "previous_direction": previous.direction.value,
                    "previous_rating": previous_rating,
                    "previous_confidence": previous.confidence,
                    "proposed": proposed,
                    "age_minutes": round(age_minutes, 1),
                    "cooldown_minutes": cooldown_minutes,
                    "max_confidence_delta": max_delta,
                },
            }
        )
        thesis.confidence_rationale = (
            f"{thesis.confidence_rationale} Stability guard: {reason}"
        ).strip()
        if reason not in thesis.risk_notes:
            thesis.risk_notes = [reason, *thesis.risk_notes]
        return thesis

    def _latest_previous_thesis(
        self,
        thesis: TradeThesis,
        cfg: dict[str, Any],
    ) -> TradeThesis | None:
        bridge = getattr(self.host, "journal_bridge", None)
        service = getattr(bridge, "service", None) if bridge is not None else None
        if service is None:
            return None
        try:
            candidates = service.list_theses(
                limit=max(int(cfg.get("memory_limit", 50)), 1)
            )
        except Exception as exc:
            logger.debug("Could not load thesis stability memory: %s", exc)
            return None

        current_symbol = str(thesis.symbol or "").strip().upper()
        current_workspace = str(thesis.workspace_id or "local").strip()
        for candidate in candidates:
            if not candidate or candidate.id == thesis.id:
                continue
            if (
                candidate.research_run_id
                and candidate.research_run_id == thesis.research_run_id
            ):
                continue
            if str(candidate.symbol or "").strip().upper() != current_symbol:
                continue
            if str(candidate.workspace_id or "local").strip() != current_workspace:
                continue
            return candidate
        return None

    def _has_stability_override(
        self,
        thesis: TradeThesis,
        cfg: dict[str, Any],
    ) -> bool:
        confidence = normalize_confidence_value(thesis.confidence)
        min_confidence = max(float(cfg.get("flip_override_confidence", 0.75)), 0.0)
        if confidence is None or confidence < min_confidence:
            return False

        text_parts = [
            thesis.thesis_text,
            thesis.invalidation,
            thesis.confirmation_condition,
            thesis.invalidation_level,
            thesis.why_this_thesis,
            thesis.confidence_rationale,
        ]
        if thesis.structured_summary is not None:
            text_parts.extend(
                [
                    thesis.structured_summary.action_summary,
                    thesis.structured_summary.confirmation_condition,
                    thesis.structured_summary.invalidation,
                    thesis.structured_summary.upside_catalyst,
                    *structured_item_text_list(thesis.structured_summary.key_reasons),
                    *structured_item_text_list(thesis.structured_summary.risks),
                ]
            )
        text = "\n".join(str(part or "") for part in text_parts).lower()
        return any(term in text for term in _STABILITY_OVERRIDE_TERMS)

    @staticmethod
    def _derive_final_confidence(
        *,
        structured_confidence: float | None,
        quant_confidence: float | None,
        quant_score: Any,
        debate: Any,
        opinions: list[Any],
        direction: ThesisDirection,
        stale_or_missing_count: int,
        contract_degradation_count: int,
    ) -> tuple[float | None, str]:
        if structured_confidence is not None:
            return round(structured_confidence, 2), "portfolio_manager"

        debate_confidence = normalize_confidence_value(
            getattr(debate, "consensus_confidence", None) if debate else None
        )
        if debate_confidence is not None:
            base = debate_confidence
            source = "debate_consensus"
        else:
            opinion_confidences = [
                confidence
                for confidence in (
                    normalize_confidence_value(getattr(opinion, "confidence", None))
                    for opinion in opinions
                )
                if confidence is not None
            ]
            if opinion_confidences:
                base = sum(opinion_confidences) / len(opinion_confidences)
                source = "opinion_average"
            elif quant_confidence is not None:
                return round(quant_confidence, 2), "quant_only"
            else:
                return None, "unavailable"

        adjusted = base + ThesisBuilder._quant_alignment_adjustment(
            quant_score=quant_score,
            quant_confidence=quant_confidence,
            direction=direction,
        )
        adjusted -= min(stale_or_missing_count * 0.02, 0.10)
        adjusted -= min(contract_degradation_count * 0.02, 0.10)
        return round(max(min(adjusted, 1.0), 0.0), 2), source

    @staticmethod
    def _quant_alignment_adjustment(
        *,
        quant_score: Any,
        quant_confidence: float | None,
        direction: ThesisDirection,
    ) -> float:
        if quant_confidence is None:
            return 0.0
        quant_bias = quant_bias_from_score(quant_score)
        thesis_bias = thesis_bias_from_direction(direction)
        if quant_bias == "unknown" or thesis_bias == "unknown":
            return 0.0
        if quant_bias == "neutral":
            if thesis_bias == "neutral":
                return min(quant_confidence * 0.05, 0.03)
            return -min((1.0 - quant_confidence) * 0.05, 0.05)
        if quant_bias == thesis_bias:
            return min(quant_confidence * 0.08, 0.06)
        return -min(quant_confidence * 0.18, 0.15)

    @staticmethod
    def _confidence_rationale(
        confidence: float | None,
        confidence_source: str,
        quant_confidence: float | None,
        quant_bias: str,
        supporting_ids: list[str],
        contradicting_ids: list[str],
    ) -> str:
        final_part = (
            f"Final confidence={confidence:.2f} (source={confidence_source})"
            if confidence is not None
            else f"Final confidence unavailable (source={confidence_source})"
        )
        quant_part = (
            f"quant confidence={quant_confidence:.2f}, quant bias={quant_bias}"
            if quant_confidence is not None
            else "quant confidence unavailable"
        )
        return (
            f"{final_part}; {quant_part}; "
            f"{len(supporting_ids)} supporting signal(s), "
            f"{len(contradicting_ids)} contradicting signal(s)."
        )

    @staticmethod
    def _structured_summary(
        *,
        payload: dict[str, Any],
        rating: str,
        direction: ThesisDirection,
        confidence: float | None,
        thesis_text: str,
        entry_zone: str | None,
        confirmation_condition: str | None,
        invalidation_level: str | None,
        target_zones: list[str],
        supporting_evidence: list[str],
        contradicting_evidence: list[str],
        stale_or_missing_data: list[str],
        contradictions: list[str],
        why_this_thesis: str,
        monitor_next: list[str],
        contract_degradation_reasons: list[str],
        market_type: str,
        missing_data: list[str],
        data_quality: float,
        data_quality_label: str,
        missing_data_reason_codes: list[str],
        system_risk_notes: list[str],
    ) -> TradeThesisStructuredSummary:
        summary_payload = dict(payload)
        summary_payload["rating"] = rating
        summary_payload["direction"] = direction.value
        summary_payload["market_type"] = (
            summary_payload.get("market_type") or market_type
        )
        summary_payload["confidence"] = confidence
        executive_summary = extract_thesis_field(
            thesis_text, "research summary"
        ) or extract_thesis_field(thesis_text, "executive summary")
        summary_payload["action_summary"] = (
            summary_payload.get("action_summary")
            or executive_summary
            or why_this_thesis
        )
        summary_payload["upside_catalyst"] = summary_payload.get("upside_catalyst") or (
            target_zones[0] if target_zones else ""
        )
        summary_payload["entry_zone"] = entry_zone or ""
        summary_payload["confirmation_condition"] = (
            summary_payload.get("confirmation_condition")
            or confirmation_condition
            or ""
        )
        summary_payload["invalidation"] = (
            summary_payload.get("invalidation") or invalidation_level or ""
        )
        summary_payload["target_zones"] = target_zones
        summary_payload["key_reasons"] = summary_payload.get("key_reasons") or (
            supporting_evidence[:3]
            or contradicting_evidence[:3]
            or ([why_this_thesis] if why_this_thesis else [])
        )
        base_risks = structured_item_text_list(summary_payload.get("risks"))
        fallback_risks = (
            stale_or_missing_data[:3]
            or contradictions[:3]
            or ["Manual review required before changing thesis stance."]
        )
        summary_payload["risks"] = (
            merge_structured_items(summary_payload.get("risks"), system_risk_notes)
            if base_risks
            else _dedupe([*fallback_risks, *system_risk_notes])
        )
        summary_payload["monitor_next"] = (
            summary_payload.get("monitor_next") or monitor_next
        )
        summary_payload["supporting_evidence"] = (
            summary_payload.get("supporting_evidence") or supporting_evidence
        )
        summary_payload["missing_data"] = missing_data
        summary_payload["missing_data_reason_codes"] = missing_data_reason_codes
        summary_payload["data_quality"] = data_quality
        summary_payload["data_quality_label"] = data_quality_label
        summary_payload["is_degraded"] = bool(
            contract_degradation_reasons or data_quality_label != "clean"
        )
        summary_payload["degradation_reasons"] = contract_degradation_reasons
        try:
            return TradeThesisStructuredSummary.model_validate(summary_payload)
        except ValidationError:
            return TradeThesisStructuredSummary.model_validate(
                {
                    "rating": rating,
                    "direction": direction.value,
                    "market_type": market_type,
                    "confidence": confidence,
                    "action_summary": executive_summary or why_this_thesis,
                    "entry_zone": entry_zone or "",
                    "confirmation_condition": confirmation_condition or "",
                    "upside_catalyst": target_zones[0] if target_zones else "",
                    "invalidation": invalidation_level or "",
                    "target_zones": target_zones,
                    "key_reasons": supporting_evidence[:3]
                    or contradicting_evidence[:3]
                    or ([why_this_thesis] if why_this_thesis else []),
                    "monitor_next": monitor_next,
                    "supporting_evidence": supporting_evidence,
                    "risks": _dedupe(
                        [
                            *(
                                stale_or_missing_data[:3]
                                or contradictions[:3]
                                or [
                                    "Manual review required before changing thesis stance."
                                ]
                            ),
                            *system_risk_notes,
                        ]
                    ),
                    "missing_data": missing_data,
                    "missing_data_reason_codes": missing_data_reason_codes,
                    "data_quality": data_quality,
                    "data_quality_label": data_quality_label,
                    "is_degraded": bool(
                        contract_degradation_reasons or data_quality_label != "clean"
                    ),
                    "degradation_reasons": contract_degradation_reasons,
                }
            )
