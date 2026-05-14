"""Trade thesis construction for completed graph states."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from tradingagents.agents.utils.thesis_json import (
    extract_trade_thesis_json,
    strip_trade_thesis_json_block,
)
from tradingagents.domain import (
    ResearchRun,
    Signal,
    ThesisDirection,
    TradeThesis,
    TradeThesisStructuredSummary,
)
from tradingagents.observability import log_event

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


def extract_thesis_field(text: str, field: str) -> str | None:
    pattern = (
        rf"(\*{{0,2}}{field}\s*(?:Zone|Level|Price)?\*{{0,2}}\s*:?\s*)"
        r"(.+?)(?:\n|$)"
    )
    match = re.search(pattern, text, re.IGNORECASE)
    return match.group(2).strip() if match else None


def extract_thesis_list_field(text: str, field: str) -> list[str]:
    value = extract_thesis_field(text, field)
    if not value:
        return []
    parts = re.split(r"[,;â€¢]|\band\b", value)
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
    ratings = {
        "buy": "Buy",
        "overweight": "Overweight",
        "hold": "Hold",
        "underweight": "Underweight",
        "sell": "Sell",
    }
    raw = payload.get("rating")
    return ratings.get(str(raw).strip().lower()) if raw is not None else None


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
            parts = re.split(r"[,;\n]|\band\b", value)
            return [part.strip() for part in parts if part.strip()]
        if isinstance(value, (list, tuple)):
            return [str(part).strip() for part in value if str(part).strip()]
        text = str(value).strip()
        return [text] if text else []
    return []


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

        rating = summary_rating(structured_payload) or self.host.process_signal(
            clean_decision
        )
        direction_map = {
            "Buy": ThesisDirection.LONG,
            "Overweight": ThesisDirection.LONG,
            "Sell": ThesisDirection.SHORT,
            "Underweight": ThesisDirection.SHORT,
            "Hold": ThesisDirection.WATCH,
        }
        direction = summary_direction(structured_payload) or direction_map.get(
            rating,
            ThesisDirection.WATCH,
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
        contract_degradation_reasons: list[str] = []
        if not structured_payload:
            contract_degradation_reasons.append("structured_summary_missing")
            prose_entry = extract_thesis_field(clean_decision, "entry")
            prose_invalidation = extract_thesis_field(clean_decision, "invalidation")
            prose_targets = extract_thesis_list_field(clean_decision, "target")
            if prose_entry:
                entry_zone = prose_entry
                contract_degradation_reasons.append("entry_zone_from_prose")
            if prose_invalidation:
                invalidation_level = prose_invalidation
                contract_degradation_reasons.append("invalidation_from_prose")
            if prose_targets:
                target_zones = prose_targets
                contract_degradation_reasons.append("target_zones_from_prose")

        for field_name, value in (
            ("entry_zone", entry_zone),
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
        run: ResearchRun | None = getattr(self.host, "current_research_run", None)
        market_type = (
            structured_payload.get("market_type")
            or final_state.get("market_type")
            or getattr(run, "market_type", None)
            or (getattr(self.host, "config", None) or {}).get("market_type", "spot")
        )
        why_this_thesis = first_nonempty_line(clean_decision) or (
            f"{direction.value} thesis generated from agent debate"
        )
        monitor_next = [
            item
            for item in [
                f"entry: {entry_zone}" if entry_zone else "",
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
        structured_summary = self._structured_summary(
            payload=structured_payload,
            rating=rating,
            direction=direction,
            confidence=confidence,
            thesis_text=clean_decision,
            entry_zone=entry_zone,
            invalidation_level=invalidation_level,
            target_zones=target_zones,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            contradictions=contradictions,
            why_this_thesis=why_this_thesis,
            contract_degradation_reasons=contract_degradation_reasons,
            market_type=market_type,
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
            },
            why_this_thesis=why_this_thesis,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            invalidation=invalidation_level or "",
            monitor_next=monitor_next,
            confidence_rationale=confidence_rationale,
            risk_notes=structured_summary.risks
            or ["Manual review required before changing thesis stance."],
        )

        thesis = self._apply_stability_guard(thesis)

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
            thesis.invalidation_level,
            thesis.why_this_thesis,
            thesis.confidence_rationale,
        ]
        if thesis.structured_summary is not None:
            text_parts.extend(
                [
                    thesis.structured_summary.action_summary,
                    thesis.structured_summary.invalidation,
                    thesis.structured_summary.upside_catalyst,
                    *thesis.structured_summary.key_reasons,
                    *thesis.structured_summary.risks,
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
        invalidation_level: str | None,
        target_zones: list[str],
        supporting_evidence: list[str],
        contradicting_evidence: list[str],
        stale_or_missing_data: list[str],
        contradictions: list[str],
        why_this_thesis: str,
        contract_degradation_reasons: list[str],
        market_type: str,
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
        summary_payload["invalidation"] = (
            summary_payload.get("invalidation") or invalidation_level or ""
        )
        summary_payload["target_zones"] = target_zones
        summary_payload["key_reasons"] = summary_payload.get("key_reasons") or (
            supporting_evidence[:3]
            or contradicting_evidence[:3]
            or ([why_this_thesis] if why_this_thesis else [])
        )
        summary_payload["risks"] = summary_payload.get("risks") or (
            stale_or_missing_data[:3]
            or contradictions[:3]
            or ["Manual review required before changing thesis stance."]
        )
        summary_payload["missing_data"] = (
            summary_payload.get("missing_data") or (stale_or_missing_data[:3])
        )
        summary_payload["is_degraded"] = bool(contract_degradation_reasons)
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
                    "upside_catalyst": target_zones[0] if target_zones else "",
                    "invalidation": invalidation_level or "",
                    "target_zones": target_zones,
                    "key_reasons": supporting_evidence[:3]
                    or contradicting_evidence[:3]
                    or ([why_this_thesis] if why_this_thesis else []),
                    "risks": stale_or_missing_data[:3]
                    or contradictions[:3]
                    or ["Manual review required before changing thesis stance."],
                    "missing_data": stale_or_missing_data[:3],
                    "is_degraded": bool(contract_degradation_reasons),
                    "degradation_reasons": contract_degradation_reasons,
                }
            )
