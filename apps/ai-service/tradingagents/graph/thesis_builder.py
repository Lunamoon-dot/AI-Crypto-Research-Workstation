"""Trade thesis construction for completed graph states."""

from __future__ import annotations

import json
import logging
import re
import uuid
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
        confidence = structured_payload.get("confidence")
        if confidence is None and quant is not None and hasattr(quant, "confidence"):
            confidence = quant.confidence
        if isinstance(confidence, str):
            raw_confidence = confidence.strip()
            is_percent = raw_confidence.endswith("%")
            raw_confidence = raw_confidence.rstrip("%").strip()
            try:
                confidence = float(raw_confidence)
            except ValueError:
                confidence = None
            else:
                if is_percent or confidence > 1:
                    confidence = confidence / 100
        heuristic_confidence = confidence
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
        debate_id = debate.id if debate else None
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
        confidence_rationale = self._confidence_rationale(
            confidence,
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

    @staticmethod
    def _confidence_rationale(
        confidence: float | None,
        supporting_ids: list[str],
        contradicting_ids: list[str],
    ) -> str:
        if confidence is not None:
            return (
                f"Quant confidence={confidence:.2f}; "
                f"{len(supporting_ids)} supporting signal(s), "
                f"{len(contradicting_ids)} contradicting signal(s)."
            )
        return (
            f"{len(supporting_ids)} supporting signal(s), "
            f"{len(contradicting_ids)} contradicting signal(s); "
            "quant confidence unavailable."
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
