"""Deterministic validation for Portfolio Manager thesis candidates."""

from __future__ import annotations

import re
from typing import Any

from pydantic import ValidationError

from luna_workstation.agents.utils.rating import normalize_rating
from luna_workstation.domain import (
    ThesisArtifactStatus,
    ThesisCandidate,
    ThesisValidationIssue,
    ThesisValidationResult,
    ThesisValidationSeverity,
    research_item_texts,
)

STRUCTURED_CANDIDATE_SOURCE = "portfolio_decision_structured"
VALIDATED_JSON_BLOCK_CANDIDATE_SOURCE = "portfolio_decision_json_block"
VALID_CANDIDATE_SOURCES = {
    STRUCTURED_CANDIDATE_SOURCE,
    VALIDATED_JSON_BLOCK_CANDIDATE_SOURCE,
}

_DIRECTION_ALIASES = {
    "long": "long",
    "buy": "long",
    "bullish": "long",
    "short": "short",
    "sell": "short",
    "bearish": "short",
    "watch": "watch",
    "hold": "watch",
    "avoid": "avoid",
    "neutral": "neutral",
}
_ALLOWED_DIRECTIONS_BY_RATING = {
    "Buy": {"long"},
    "Overweight": {"long"},
    "Hold": {"watch", "neutral"},
    "Underweight": {"avoid"},
    "Sell": {"short"},
}
_EXECUTION_INSTRUCTION_RE = re.compile(
    r"\b(?:market order|limit order|buy now|sell now)\b|"
    r"\b(?:place|submit|send|execute)\s+(?:an?\s+)?"
    r"(?:market|limit|exchange|order|trade)\b",
    re.IGNORECASE,
)


class ThesisValidator:
    """Validate the structured thesis boundary without LLM judgment."""

    def validate(
        self,
        *,
        candidate: ThesisCandidate | dict[str, Any] | None,
        source_contract: str | None,
        data_quality_label: str,
    ) -> ThesisValidationResult:
        issues: list[ThesisValidationIssue] = []
        degradation_reasons: list[str] = []
        blocked_reasons: list[str] = []
        confidence_cap = _confidence_cap_for_data_quality(data_quality_label)

        if source_contract not in VALID_CANDIDATE_SOURCES:
            _add_issue(
                issues,
                blocked_reasons,
                code="candidate_source_not_structured",
                severity=ThesisValidationSeverity.BLOCKER,
                message="A valid thesis requires typed PortfolioDecision output or a validated thesis candidate JSON block.",
                field="source_contract",
            )

        if candidate is None:
            _add_issue(
                issues,
                blocked_reasons,
                code="structured_candidate_missing",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Structured ThesisCandidate output is required.",
            )
            return _result(issues, degradation_reasons, blocked_reasons, confidence_cap)

        raw_candidate = candidate if isinstance(candidate, dict) else candidate.model_dump()
        schema_version = raw_candidate.get("schema_version")
        if (
            isinstance(candidate, ThesisCandidate)
            and "schema_version" not in candidate.model_fields_set
        ):
            schema_version = None
        if not str(schema_version or "").strip():
            _add_issue(
                issues,
                blocked_reasons,
                code="schema_version_missing",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Candidate schema version is required.",
                field="schema_version",
            )

        try:
            model = (
                candidate
                if isinstance(candidate, ThesisCandidate)
                else ThesisCandidate.model_validate(candidate)
            )
        except ValidationError as exc:
            _add_issue(
                issues,
                blocked_reasons,
                code="candidate_schema_invalid",
                severity=ThesisValidationSeverity.BLOCKER,
                message=f"Candidate could not be parsed: {exc.errors()[0]['msg']}",
            )
            return _result(issues, degradation_reasons, blocked_reasons, confidence_cap)

        rating = normalize_rating(model.rating)
        if rating is None:
            _add_issue(
                issues,
                blocked_reasons,
                code="rating_missing_or_invalid",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Rating must be one of Buy, Overweight, Hold, Underweight, or Sell.",
                field="rating",
            )

        direction = _DIRECTION_ALIASES.get(model.direction.strip().lower())
        if direction is None:
            _add_issue(
                issues,
                blocked_reasons,
                code="direction_missing_or_invalid",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Direction must be long, short, watch, avoid, or neutral.",
                field="direction",
            )
        elif rating is not None and direction not in _ALLOWED_DIRECTIONS_BY_RATING[rating]:
            _add_issue(
                issues,
                blocked_reasons,
                code="rating_direction_conflict",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Rating and direction are inconsistent.",
                field="direction",
            )

        for field_name, code, message in (
            ("confidence", "confidence_missing", "Confidence is required."),
            ("action_summary", "action_summary_missing", "Action summary is required."),
            (
                "confirmation_condition",
                "confirmation_condition_missing",
                "Confirmation condition is required.",
            ),
            ("invalidation", "invalidation_missing", "Invalidation is required."),
        ):
            value = getattr(model, field_name)
            if value is None or (isinstance(value, str) and not value.strip()):
                _add_issue(
                    issues,
                    blocked_reasons,
                    code=code,
                    severity=ThesisValidationSeverity.BLOCKER,
                    message=message,
                    field=field_name,
                )

        reason_texts = [
            *research_item_texts(model.key_reasons),
            *research_item_texts(model.risks),
        ]
        if not any(text.strip() for text in reason_texts) and not model.missing_data:
            _add_issue(
                issues,
                blocked_reasons,
                code="reasons_or_missing_data_missing",
                severity=ThesisValidationSeverity.BLOCKER,
                message="At least one reason, risk, or explicit missing-data note is required.",
                field="key_reasons",
            )

        if _contains_execution_instruction(model):
            _add_issue(
                issues,
                blocked_reasons,
                code="execution_instruction_detected",
                severity=ThesisValidationSeverity.BLOCKER,
                message="Theses must not contain exchange order or execution instructions.",
            )

        if not _text(model.entry_zone):
            _add_issue(
                issues,
                degradation_reasons,
                code="entry_zone_missing",
                severity=ThesisValidationSeverity.WARNING,
                message="Entry zone is missing.",
                field="entry_zone",
            )
        if not _has_objective_levels(model):
            _add_issue(
                issues,
                degradation_reasons,
                code="target_zones_missing",
                severity=ThesisValidationSeverity.WARNING,
                message="Target zones are missing.",
                field="target_zones",
            )

        evidence = _all_evidence(model)
        if not evidence:
            _add_issue(
                issues,
                degradation_reasons,
                code="supporting_evidence_missing",
                severity=ThesisValidationSeverity.WARNING,
                message="Supporting evidence references are missing.",
                field="supporting_evidence",
            )
        elif not any(item.evidence_kind == "observed" for item in evidence):
            _add_issue(
                issues,
                degradation_reasons,
                code="supporting_evidence_reasoning_only",
                severity=ThesisValidationSeverity.WARNING,
                message="Supporting evidence is reasoning-only.",
                field="supporting_evidence",
            )

        if model.missing_data:
            _add_issue(
                issues,
                degradation_reasons,
                code="missing_data_declared",
                severity=ThesisValidationSeverity.WARNING,
                message="Candidate declares missing market data.",
                field="missing_data",
            )
        if data_quality_label != "clean":
            _add_issue(
                issues,
                degradation_reasons,
                code=f"data_quality_{data_quality_label}",
                severity=ThesisValidationSeverity.WARNING,
                message=f"Data quality is {data_quality_label}.",
                field="data_quality_label",
            )

        return _result(issues, degradation_reasons, blocked_reasons, confidence_cap)


def _result(
    issues: list[ThesisValidationIssue],
    degradation_reasons: list[str],
    blocked_reasons: list[str],
    confidence_cap: float | None,
) -> ThesisValidationResult:
    if blocked_reasons:
        status = ThesisArtifactStatus.BLOCKED
    elif degradation_reasons:
        status = ThesisArtifactStatus.DEGRADED
    else:
        status = ThesisArtifactStatus.VALID
    return ThesisValidationResult(
        status=status,
        issues=issues,
        degradation_reasons=_dedupe(degradation_reasons),
        blocked_reasons=_dedupe(blocked_reasons),
        confidence_cap=confidence_cap,
    )


def _add_issue(
    issues: list[ThesisValidationIssue],
    reasons: list[str],
    *,
    code: str,
    severity: ThesisValidationSeverity,
    message: str,
    field: str | None = None,
) -> None:
    issues.append(
        ThesisValidationIssue(
            code=code,
            severity=severity,
            message=message,
            field=field,
            source="thesis_validator",
        )
    )
    reasons.append(code)


def _contains_execution_instruction(candidate: ThesisCandidate) -> bool:
    text = "\n".join(
        [
            candidate.action_summary,
            candidate.investment_thesis,
            candidate.confirmation_condition,
            candidate.invalidation,
            _text(candidate.entry_zone),
            *candidate.target_zones,
            *candidate.profit_targets,
            *candidate.downside_objectives,
            *candidate.accumulation_zones,
            *candidate.indicator_thresholds,
            *research_item_texts(candidate.key_reasons),
            *research_item_texts(candidate.risks),
            *research_item_texts(candidate.monitor_next),
        ]
    )
    return bool(_EXECUTION_INSTRUCTION_RE.search(text))


def _has_objective_levels(candidate: ThesisCandidate) -> bool:
    return any(
        [
            candidate.target_zones,
            candidate.profit_targets,
            candidate.downside_objectives,
            candidate.accumulation_zones,
        ]
    )


def _all_evidence(candidate: ThesisCandidate):
    evidence = list(candidate.supporting_evidence)
    for item in [*candidate.key_reasons, *candidate.risks, *candidate.monitor_next]:
        if hasattr(item, "supporting_evidence"):
            evidence.extend(item.supporting_evidence)
    return evidence


def _confidence_cap_for_data_quality(data_quality_label: str) -> float | None:
    return {
        "degraded": 0.45,
        "insufficient_data": 0.25,
    }.get(data_quality_label)


def _text(value: object) -> str:
    return str(value or "").strip()


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result
