"""Deterministic scenario generation for saved trade theses."""

from __future__ import annotations

import logging
from luna_workstation.domain import (
    ConflictLevel,
    ResearchDebate,
    Scenario,
    ScenarioProbabilityBand,
    Signal,
    SignalDirection,
    ThesisDirection,
    TradeThesis,
)
from luna_workstation.templates.registry import TemplateRegistry
from luna_workstation.utils.collections import dedupe

logger = logging.getLogger(__name__)


def build_scenarios_for_thesis(
    thesis: TradeThesis,
    *,
    debate: ResearchDebate | None = None,
    signals: list[Signal] | None = None,
    template_name: str | None = None,
) -> list[Scenario]:
    """Create a small conditional market map from structured thesis context.

    When *template_name* matches a registered setup template, scenario
    conditions, expected behavior, and invalidation are enriched with
    template-specific guidance.

    **Phase 5 enforcement**: Validates required template fields against
    available context.  If critical fields are missing, degrades to the
    generic ``agent_debate`` template and records the degradation in
    each scenario's ``template_metadata``.
    """

    # --- Phase 5: validate template required fields ---
    context_values: dict[str, str] = {}
    if thesis.evidence:
        context_values.update({k: str(v) for k, v in thesis.evidence.items()})
    for sig in signals or []:
        context_values[sig.signal_type] = sig.summary or sig.signal_type

    validation = TemplateRegistry.validate_template_context(
        template_name,
        context_values,
        required_coverage_threshold=0.5,
    )
    effective_template_name = validation["effective_setup_type"]
    template = (
        TemplateRegistry.get(effective_template_name)
        if effective_template_name
        else None
    )

    if validation["is_degraded"]:
        logger.warning(
            "build_scenarios_for_thesis: template '%s' degraded to '%s': %s",
            template_name,
            effective_template_name,
            validation["degrade_reason"],
        )

    # Build template_metadata to persist on every generated scenario
    template_metadata: dict = {
        "setup_type": effective_template_name,
        "requested_setup_type": template_name,
        "template_degraded": validation["is_degraded"],
        "missing_fields": validation["missing_fields"],
        "available_fields": validation["available_fields"],
        "degrade_reason": validation["degrade_reason"],
    }

    signals = signals or []
    scenarios = [
        _neutral_wait_scenario(thesis, signals=signals, template=template),
        _directional_confirmation(
            thesis, debate=debate, signals=signals, template=template
        ),
        _invalidation_scenario(
            thesis, debate=debate, signals=signals, template=template
        ),
    ]

    # Attach template_metadata to every scenario
    for scenario, horizon, timeframe_label in zip(
        scenarios,
        ("short_term", "mid_term", "long_term"),
        ("24-72h", "1-3w", "1-3m"),
    ):
        scenario.horizon = horizon
        scenario.timeframe_label = timeframe_label
        scenario.template_metadata = {
            **template_metadata,
            "horizon": horizon,
            "timeframe_label": timeframe_label,
        }

    return _dedupe_scenarios(scenarios)[:3]


def _directional_confirmation(
    thesis: TradeThesis,
    *,
    debate: ResearchDebate | None,
    signals: list[Signal],
    template=None,
) -> Scenario:
    if thesis.direction == ThesisDirection.SHORT:
        condition = "If downside confirmation appears and support fails."
        expected = "Bearish continuation becomes more likely; avoid treating bounces as confirmation."
        action = "review short thesis"
        aligned_direction = SignalDirection.BEARISH
    elif thesis.direction == ThesisDirection.LONG:
        condition = "If price confirms strength with improving participation."
        expected = "Bullish continuation becomes more likely; review whether the thesis still has clean risk/reward."
        action = "review long thesis"
        aligned_direction = SignalDirection.BULLISH
    else:
        condition = (
            "If price resolves in the thesis direction with fresh supporting evidence."
        )
        expected = "The watch thesis can be upgraded only after confirmation from price and supporting signals."
        action = "review thesis"
        aligned_direction = SignalDirection.BULLISH

    evidence = _signal_summaries(signals, aligned_direction)
    if evidence:
        condition = f"{condition} Supporting context: {evidence[0]}"

    if template is not None and template.expected_behavior_template:
        expected = f"{expected} Template guidance ({template.name}): {template.expected_behavior_template}"
    if template is not None and template.invalidation_template:
        invalidation = thesis.invalidation_level or template.invalidation_template
    else:
        invalidation = (
            thesis.invalidation_level
            or "Invalid if confirmation fails or the thesis risk level breaks."
        )

    return Scenario(
        thesis_id=thesis.id,
        condition=condition,
        expected_market_behavior=expected,
        probability_band=_probability_from_confidence(thesis.confidence, debate),
        invalidation=invalidation,
        risk_map=_risk_map(thesis, signals),
        suggested_user_action=action,
    )


def _invalidation_scenario(
    thesis: TradeThesis,
    *,
    debate: ResearchDebate | None,
    signals: list[Signal],
    template=None,
) -> Scenario:
    contradicting = _signal_summaries(
        signals, _opposite_signal_direction(thesis.direction)
    )
    condition = (
        thesis.invalidation_level
        or "If the thesis invalidation condition is triggered."
    )
    if contradicting:
        condition = f"{condition} Contradicting context: {contradicting[0]}"

    expected = "The thesis quality deteriorates; preserve optionality and avoid forcing the original view."
    if template is not None and template.invalidation_template:
        expected = f"{expected} Template invalidation guide ({template.name}): {template.invalidation_template}"

    risks = (thesis.contradictions or []) + thesis.risk_notes + contradicting
    if template is not None:
        risks = risks + template.risk_map_defaults

    return Scenario(
        thesis_id=thesis.id,
        condition=condition,
        expected_market_behavior=expected,
        probability_band=(
            ScenarioProbabilityBand.MEDIUM
            if _has_material_conflict(thesis, debate)
            else ScenarioProbabilityBand.LOW
        ),
        invalidation="This scenario is invalid if price reclaims confirmation with improving evidence.",
        risk_map=dedupe(risks)[:5],
        suggested_user_action="stand aside or reassess",
    )


def _neutral_wait_scenario(
    thesis: TradeThesis,
    *,
    signals: list[Signal],
    template=None,
) -> Scenario:
    neutral_context = _signal_summaries(signals, SignalDirection.NEUTRAL)
    condition = (
        "If evidence remains mixed and price stays inside the current decision range."
    )
    if neutral_context:
        condition = f"{condition} Neutral context: {neutral_context[0]}"
    if template is not None and template.condition_template:
        condition = f"{condition} Template context ({template.name}): {template.condition_template}"

    expected = "Range or chop remains the base case; waiting for cleaner evidence is preferable."
    if template is not None and template.expected_behavior_template:
        expected = f"{expected} Template guidance ({template.name}): {template.expected_behavior_template}"

    risks = thesis.risk_notes + ["Chop can create false confirmation signals."]
    if template is not None:
        risks = risks + template.risk_map_defaults

    return Scenario(
        thesis_id=thesis.id,
        condition=condition,
        expected_market_behavior=expected,
        probability_band=ScenarioProbabilityBand.MEDIUM,
        invalidation="Invalid if a directional confirmation or invalidation scenario triggers first.",
        risk_map=dedupe(risks)[:5],
        suggested_user_action="watch",
    )


def _contradiction_scenario(
    thesis: TradeThesis,
    *,
    debate: ResearchDebate | None,
    template=None,
) -> Scenario:
    contradictions = thesis.contradictions or (debate.contradictions if debate else [])
    condition = (
        "If the main contradiction strengthens while the thesis direction stalls."
    )
    if contradictions:
        condition = f"{condition} Main contradiction: {contradictions[0]}"

    risks = contradictions + thesis.risk_notes
    if template is not None:
        risks = risks + template.risk_map_defaults

    return Scenario(
        thesis_id=thesis.id,
        condition=condition,
        expected_market_behavior=(
            "Conflict risk increases; confidence should be reduced until the contradiction resolves."
        ),
        probability_band=ScenarioProbabilityBand.MEDIUM,
        invalidation="Invalid if the contradiction fades and supporting evidence broadens.",
        risk_map=dedupe(risks)[:5],
        suggested_user_action="reduce confidence and review evidence",
    )


def _probability_from_confidence(
    confidence: float | None,
    debate: ResearchDebate | None,
) -> ScenarioProbabilityBand:
    if confidence is None:
        return ScenarioProbabilityBand.UNKNOWN
    if debate and debate.conflict_level == ConflictLevel.HIGH:
        return (
            ScenarioProbabilityBand.MEDIUM
            if confidence >= 0.7
            else ScenarioProbabilityBand.LOW
        )
    if confidence >= 0.7:
        return ScenarioProbabilityBand.HIGH
    if confidence >= 0.4:
        return ScenarioProbabilityBand.MEDIUM
    return ScenarioProbabilityBand.LOW


def _has_material_conflict(thesis: TradeThesis, debate: ResearchDebate | None) -> bool:
    if thesis.contradictions:
        return True
    return bool(
        debate and debate.conflict_level in (ConflictLevel.MEDIUM, ConflictLevel.HIGH)
    )


def _opposite_signal_direction(direction: ThesisDirection) -> SignalDirection:
    if direction == ThesisDirection.SHORT:
        return SignalDirection.BULLISH
    return SignalDirection.BEARISH


def _signal_summaries(signals: list[Signal], direction: SignalDirection) -> list[str]:
    return [
        signal.summary or f"{signal.signal_type} is {signal.direction.value}"
        for signal in signals
        if signal.direction == direction
    ][:3]


def _risk_map(thesis: TradeThesis, signals: list[Signal]) -> list[str]:
    stale_or_unknown = [
        f"{signal.signal_type} freshness is {signal.provenance.freshness.value}"
        for signal in signals
        if signal.provenance.freshness.value in ("stale", "unknown")
    ]
    risks = thesis.risk_notes + thesis.contradictions + stale_or_unknown
    return dedupe(risks or ["Manual review required before acting on this scenario."])[
        :5
    ]


def _dedupe_scenarios(scenarios: list[Scenario]) -> list[Scenario]:
    seen = set()
    result = []
    for scenario in scenarios:
        key = scenario.condition.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(scenario)
    return result
