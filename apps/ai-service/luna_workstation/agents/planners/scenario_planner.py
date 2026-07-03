"""Scenario planner: template-guided structured scenarios for thesis planning.

Phase 5 enforcement: validates template required fields before calling the
LLM.  When critical fields are missing the planner degrades to the generic
``agent_debate`` template and emits a clear warning.
"""

from __future__ import annotations

import functools
import json
import logging
import re
from datetime import datetime
from typing import Any

from langchain_core.messages import AIMessage

from luna_workstation.agents.schemas import (
    ScenarioHorizon,
    ScenarioItem,
    ScenarioPlan,
    render_scenario_plan,
)
from luna_workstation.agents.utils.agent_utils import (
    build_current_price_context,
    build_instrument_context,
    get_language_instruction,
    guard_untrusted_context,
)
from luna_workstation.agents.utils.structured import bind_structured
from luna_workstation.templates.registry import TemplateRegistry

logger = logging.getLogger(__name__)

_TEMPLATE_LINE = (
    "setup_type must be one of: breakout, range_reversion, funding_squeeze, "
    "news_event, macro_event, trend_pullback, liquidity_sweep, or agent_debate."
)
_HORIZON_WINDOWS = {
    ScenarioHorizon.SHORT_TERM: "24-72h",
    ScenarioHorizon.MID_TERM: "1-3w",
    ScenarioHorizon.LONG_TERM: "1-3m",
}
_HORIZON_POLICIES = {
    ScenarioHorizon.SHORT_TERM: (
        "Build only the tactical short-term branch. Emphasize near-term trigger, "
        "liquidity/event reaction, and a tight invalidation."
    ),
    ScenarioHorizon.MID_TERM: (
        "Build only the medium-term thesis follow-through branch. Emphasize the "
        "catalyst path over weeks, confirmation, and weakening conditions."
    ),
    ScenarioHorizon.LONG_TERM: (
        "Build only the long-term structural branch. Emphasize regime durability, "
        "persistent invalidation, and what would make the thesis structurally wrong."
    ),
}

_DATE_REFERENCE_RE = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b"
    r"|\b\d{4}-\d{2}-\d{2}\b"
    r"|\b\d{1,2}/\d{1,2}/\d{2,4}\b",
    re.IGNORECASE,
)
_TIMEFRAME_REFERENCE_RE = re.compile(
    r"\b(1m|5m|15m|1h|4h|1d|1w|1M|daily|weekly|monthly)\b",
    re.IGNORECASE,
)
_SCENARIO_PLAN_JSON_MARKER = "SCENARIO_PLAN_JSON"
_SCENARIO_PLAN_JSON_BLOCK_RE = re.compile(
    rf"{_SCENARIO_PLAN_JSON_MARKER}\s*:?\s*```(?:json)?\s*(.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_FENCED_CODE_BLOCK_RE = re.compile(
    r"```(?:json)?\s*(.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_SCENARIO_PLAN_JSON_KEY_RE = re.compile(
    r'"(?:setup_type|scenarios|scenario_name|watch_triggers)"\s*:',
    re.IGNORECASE,
)


def _build_template_context(state: dict[str, Any]) -> dict[str, str]:
    """Collect context values from state for template field validation.

    Gathers evidence from research reports, investment plan, PM decision,
    and any quant signal data available in the state.
    """
    ctx: dict[str, str] = {}
    # Research reports as context keys
    for key in (
        "market_report",
        "sentiment_report",
        "news_report",
        "fundamentals_report",
    ):
        val = state.get(key, "")
        if val:
            ctx[key] = str(val)[:2000]
    # Investment plan and PM decision
    for key in ("investment_plan", "final_trade_decision"):
        val = state.get(key, "")
        if val:
            ctx[key] = str(val)[:2000]
    # Any pre-computed signal data
    signal_text = state.get("quant_signal_text", "") or state.get("signal_text", "")
    if signal_text:
        ctx["quant_signal"] = str(signal_text)[:2000]
    return ctx


def _source_evidence_text(
    state: dict[str, Any], research_reports: dict[str, str]
) -> str:
    parts = [
        state.get("investment_plan", ""),
        state.get("final_trade_decision", ""),
        state.get("quant_signal_text", ""),
        state.get("signal_text", ""),
        *research_reports.values(),
    ]
    return "\n".join(str(part) for part in parts if part)


def _analysis_date_aliases(analysis_date: str) -> set[str]:
    raw = str(analysis_date or "").strip()
    aliases = {raw.lower()} if raw else set()
    if not raw:
        return aliases
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return aliases

    day = str(parsed.day)
    year = str(parsed.year)
    for month in (parsed.strftime("%B"), parsed.strftime("%b")):
        aliases.add(f"{month} {day}".lower())
        aliases.add(f"{month} {day}, {year}".lower())
    return aliases


def _replace_unsupported_calendar_dates(
    text: str,
    *,
    evidence_text: str,
    analysis_date: str,
) -> str:
    if not text:
        return text

    evidence_lower = evidence_text.lower()
    allowed = _analysis_date_aliases(analysis_date)

    def replace(match: re.Match[str]) -> str:
        token = match.group(0)
        normalized = token.lower()
        if normalized in allowed or normalized in evidence_lower:
            return token
        return "prior"

    return _DATE_REFERENCE_RE.sub(replace, text)


def _ground_scenario_plan_dates(
    plan: ScenarioPlan,
    *,
    evidence_text: str,
    analysis_date: str,
) -> ScenarioPlan:
    grounded_scenarios = []
    for scenario in plan.scenarios:
        grounded_scenarios.append(
            scenario.model_copy(
                update={
                    "scenario_name": _replace_unsupported_calendar_dates(
                        scenario.scenario_name,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "condition": _replace_unsupported_calendar_dates(
                        scenario.condition,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "expected_behavior": _replace_unsupported_calendar_dates(
                        scenario.expected_behavior,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "invalidation": _replace_unsupported_calendar_dates(
                        scenario.invalidation,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "risk_factors": [
                        _replace_unsupported_calendar_dates(
                            risk,
                            evidence_text=evidence_text,
                            analysis_date=analysis_date,
                        )
                        for risk in scenario.risk_factors
                    ],
                    "evidence": [
                        _replace_unsupported_calendar_dates(
                            item,
                            evidence_text=evidence_text,
                            analysis_date=analysis_date,
                        )
                        for item in scenario.evidence
                    ],
                    "watch_triggers": [
                        _replace_unsupported_calendar_dates(
                            trigger,
                            evidence_text=evidence_text,
                            analysis_date=analysis_date,
                        )
                        for trigger in scenario.watch_triggers
                    ],
                    "impact_on_thesis": _replace_unsupported_calendar_dates(
                        scenario.impact_on_thesis,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "suggested_action": _replace_unsupported_calendar_dates(
                        scenario.suggested_action,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                    "as_of": _replace_unsupported_calendar_dates(
                        scenario.as_of,
                        evidence_text=evidence_text,
                        analysis_date=analysis_date,
                    ),
                }
            )
        )
    return plan.model_copy(update={"scenarios": grounded_scenarios})


def _normalize_timeframe_label(value: str) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "daily": "1D",
        "1d": "1D",
        "weekly": "1W",
        "1w": "1W",
        "monthly": "1M",
        "1m": "1M",
        "4h": "4H",
        "1h": "1H",
        "15m": "15m",
        "5m": "5m",
        "1m_lower": "1m",
    }
    if normalized == "1m":
        return "1m"
    return aliases.get(normalized, str(value or "").strip())


def _extract_context_timeframe(*parts: str) -> str:
    text = "\n".join(str(part or "") for part in parts if part).strip()
    if not text:
        return ""
    match = _TIMEFRAME_REFERENCE_RE.search(text)
    if not match:
        return ""
    return _normalize_timeframe_label(match.group(1))


def _default_scenario_sources(research_reports: dict[str, str]) -> list[str]:
    labels = [
        name for name, value in research_reports.items() if str(value or "").strip()
    ]
    return labels[:3]


def _enrich_scenario_plan_provenance(
    plan: ScenarioPlan,
    *,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict[str, Any],
) -> ScenarioPlan:
    fallback_as_of = str(analysis_date or "").strip()
    fallback_timeframe = _extract_context_timeframe(
        state.get("quant_signal_text", ""),
        state.get("signal_text", ""),
        *research_reports.values(),
        state.get("investment_plan", ""),
        state.get("final_trade_decision", ""),
    )
    fallback_sources = _default_scenario_sources(research_reports)

    enriched = []
    for scenario in plan.scenarios:
        sources = [item.strip() for item in scenario.source if str(item or "").strip()]
        enriched.append(
            scenario.model_copy(
                update={
                    "as_of": str(scenario.as_of or "").strip() or fallback_as_of,
                    "timeframe": str(scenario.timeframe or "").strip()
                    or fallback_timeframe,
                    "source": sources or fallback_sources,
                }
            )
        )
    return plan.model_copy(update={"scenarios": enriched})


def _scenario_with_horizon(
    scenario: ScenarioItem,
    horizon: ScenarioHorizon,
) -> ScenarioItem:
    return scenario.model_copy(
        update={
            "horizon": horizon,
            "timeframe_label": scenario.timeframe_label or _HORIZON_WINDOWS[horizon],
        }
    )


def _scenario_content_key(scenario: ScenarioItem) -> str:
    return " ".join(
        str(part or "").strip().lower()
        for part in (
            scenario.condition,
            scenario.expected_behavior,
            scenario.invalidation,
        )
        if str(part or "").strip()
    )


def _fallback_scenario(
    *,
    horizon: ScenarioHorizon,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict[str, Any],
) -> ScenarioItem:
    fallback_sources = _default_scenario_sources(research_reports) or [
        "scenario_planner"
    ]
    fallback_timeframe = _extract_context_timeframe(
        state.get("quant_signal_text", ""),
        state.get("signal_text", ""),
        *research_reports.values(),
    )
    label = {
        ScenarioHorizon.SHORT_TERM: "Short-term tactical branch",
        ScenarioHorizon.MID_TERM: "Mid-term thesis follow-through",
        ScenarioHorizon.LONG_TERM: "Long-term structural branch",
    }[horizon]
    condition = {
        ScenarioHorizon.SHORT_TERM: (
            "If near-term price, liquidity, or event reaction confirms the current thesis."
        ),
        ScenarioHorizon.MID_TERM: (
            "If catalyst follow-through confirms or weakens the current thesis over several sessions."
        ),
        ScenarioHorizon.LONG_TERM: (
            "If structural evidence shows the thesis is durable or structurally invalidated."
        ),
    }[horizon]
    return ScenarioItem(
        horizon=horizon,
        timeframe_label=_HORIZON_WINDOWS[horizon],
        scenario_name=label,
        direction="neutral",
        thesis_impact="medium",
        condition=condition,
        expected_behavior=(
            "Planner used a deterministic fallback for this horizon; review current "
            "reports and Portfolio Manager decision before acting."
        ),
        evidence=["Structured horizon output missing or unusable."],
        watch_triggers=["Re-run scenario planner when fresh evidence is available."],
        impact_on_thesis="Keeps the thesis on manual review until this horizon is regenerated.",
        probability_band="unknown",
        invalidation="Invalid if current evidence contradicts this fallback branch.",
        risk_factors=["Fallback scenario has limited evidence coverage."],
        suggested_action="review",
        as_of=str(analysis_date or "").strip(),
        timeframe=fallback_timeframe,
        source=fallback_sources[:3],
    )


def _normalize_horizon_plan(
    plans: list[ScenarioPlan],
    *,
    setup_type: str,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict[str, Any],
) -> ScenarioPlan:
    by_horizon: dict[ScenarioHorizon, ScenarioItem] = {}
    seen_content: set[str] = set()
    for requested_horizon, plan in zip(ScenarioHorizon, plans):
        for scenario in plan.scenarios:
            horizon = scenario.horizon or requested_horizon
            if horizon not in _HORIZON_WINDOWS or horizon in by_horizon:
                continue
            if not str(scenario.condition or "").strip():
                continue
            if not str(scenario.expected_behavior or "").strip():
                continue
            content_key = _scenario_content_key(scenario)
            if content_key in seen_content:
                continue
            by_horizon[horizon] = _scenario_with_horizon(scenario, horizon)
            seen_content.add(content_key)

    scenarios = [
        by_horizon.get(horizon)
        or _fallback_scenario(
            horizon=horizon,
            analysis_date=analysis_date,
            research_reports=research_reports,
            state=state,
        )
        for horizon in ScenarioHorizon
    ]
    return ScenarioPlan(setup_type=setup_type or "agent_debate", scenarios=scenarios)


def _normalize_free_text_json_plan(
    plan: ScenarioPlan,
    *,
    setup_type: str,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict[str, Any],
) -> ScenarioPlan:
    horizon_plans = [
        ScenarioPlan(setup_type=plan.setup_type or setup_type, scenarios=[scenario])
        for scenario in plan.scenarios[:3]
    ]
    return _normalize_horizon_plan(
        horizon_plans,
        setup_type=plan.setup_type or setup_type,
        analysis_date=analysis_date,
        research_reports=research_reports,
        state=state,
    )


def _extract_scenario_plan_json(text: str | None) -> str:
    if not text:
        return ""
    match = _SCENARIO_PLAN_JSON_BLOCK_RE.search(text)
    if match:
        return _extract_json_object_text(match.group(1))
    marker_index = text.upper().find(_SCENARIO_PLAN_JSON_MARKER)
    if marker_index >= 0:
        tail = text[marker_index + len(_SCENARIO_PLAN_JSON_MARKER) :]
        return _extract_json_object_text(tail)
    for block in _FENCED_CODE_BLOCK_RE.finditer(text):
        candidate = _extract_json_object_text(block.group(1))
        if _looks_like_scenario_plan_json(candidate):
            return candidate
    return ""


def _strip_scenario_plan_json_block(text: str | None) -> str:
    if not text:
        return ""
    stripped = _SCENARIO_PLAN_JSON_BLOCK_RE.sub("", text).strip()
    marker_index = stripped.upper().find(_SCENARIO_PLAN_JSON_MARKER)
    if marker_index >= 0:
        stripped = stripped[:marker_index].strip()
    stripped = _FENCED_CODE_BLOCK_RE.sub(
        _strip_scenario_plan_json_code_block,
        stripped,
    ).strip()
    return stripped


def _strip_scenario_plan_json_code_block(match: re.Match[str]) -> str:
    candidate = _extract_json_object_text(match.group(1))
    return "" if _looks_like_scenario_plan_json(candidate) else match.group(0)


def _extract_json_object_text(raw: str | None) -> str:
    if not raw:
        return ""
    decoder = json.JSONDecoder()
    for index, char in enumerate(raw):
        if char != "{":
            continue
        try:
            loaded, end = decoder.raw_decode(raw[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(loaded, dict):
            return raw[index : index + end].strip()
    return _extract_balanced_json_object_text(raw)


def _extract_balanced_json_object_text(raw: str) -> str:
    start = raw.find("{")
    if start < 0:
        return ""
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(raw)):
        char = raw[index]
        if escaped:
            escaped = False
            continue
        if char == "\\" and in_string:
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return raw[start : index + 1].strip()
    return ""


def _looks_like_scenario_plan_json(raw: str | None) -> bool:
    return bool(raw and _SCENARIO_PLAN_JSON_KEY_RE.search(raw))


def _validated_free_text_json_plan(
    text: str,
    *,
    setup_type: str,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict[str, Any],
    source_evidence: str,
) -> ScenarioPlan | None:
    candidate_json = _extract_scenario_plan_json(text)
    if not candidate_json:
        return None
    try:
        plan = ScenarioPlan.model_validate_json(candidate_json)
    except Exception as exc:
        logger.warning("ScenarioPlanner: invalid SCENARIO_PLAN_JSON block: %s", exc)
        return None
    plan = _normalize_free_text_json_plan(
        plan,
        setup_type=setup_type,
        analysis_date=analysis_date,
        research_reports=research_reports,
        state=state,
    )
    plan = _ground_scenario_plan_dates(
        plan,
        evidence_text=source_evidence,
        analysis_date=analysis_date,
    )
    return _enrich_scenario_plan_provenance(
        plan,
        analysis_date=analysis_date,
        research_reports=research_reports,
        state=state,
    )


def _render_scenario_continuity_handoff(handoff: object) -> str:
    if not isinstance(handoff, dict) or not handoff:
        return ""
    lines = [
        "Portfolio Manager scenario continuity handoff (prior memory only; not current evidence):"
    ]
    for key in (
        "continuity_relation",
        "summary",
        "short_term_focus",
        "mid_term_focus",
        "long_term_focus",
        "carry_forward_watchpoints",
        "carry_forward_invalidations",
        "stale_prior",
    ):
        value = handoff.get(key)
        if value:
            lines.append(f"- {key}: {value}")
    return "\n".join(lines)


def render_scenario_feedback_playbook(context: object) -> str:
    if not isinstance(context, dict) or not context:
        return ""
    playbook = context.get("scenario_feedback_playbook")
    if not isinstance(playbook, dict):
        return ""
    lessons = playbook.get("lessons") or []
    gates = playbook.get("gates") or []
    lines = [
        "Scenario feedback playbook (evaluated prior outcomes only; compact guardrails):"
    ]
    if isinstance(lessons, list):
        for lesson in lessons[:8]:
            if not isinstance(lesson, dict):
                continue
            statement = _compact_text(lesson.get("statement"))
            if not statement:
                continue
            confidence = _compact_text(lesson.get("confidence") or "low") or "low"
            lines.append(f"- {statement} ({confidence})")
    if isinstance(gates, list):
        for gate in gates[:5]:
            if not isinstance(gate, dict):
                continue
            reason = _compact_text(gate.get("reason"))
            applies_to = _compact_text(gate.get("applies_to") or "entry") or "entry"
            if reason:
                lines.append(f"- gate:{applies_to}: {reason}")
    return "\n".join(lines) if len(lines) > 1 else ""


def render_scenario_reliability_digest(digest: object) -> str:
    if isinstance(digest, dict):
        profiles = digest.get("profiles") or digest.get("items") or []
    elif isinstance(digest, list):
        profiles = digest
    else:
        profiles = []
    if not isinstance(profiles, list) or not profiles:
        return ""

    lines = [
        "Scenario reliability digest (workspace-scoped outcome history; compact aggregates only):"
    ]
    for profile in profiles[:5]:
        if not isinstance(profile, dict):
            continue
        symbol = _compact_text(profile.get("symbol") or "unknown")
        market_type = _compact_text(profile.get("market_type") or "mixed")
        horizon = _compact_text(profile.get("horizon") or "unknown")
        relation = _compact_text(profile.get("relation_to_thesis") or "unknown")
        action_bias = _compact_text(profile.get("action_bias") or "unknown")
        sample_size = profile.get("sample_size")
        rates = [
            f"hit_rate={_compact_pct(profile.get('hit_rate'))}",
            f"invalidation_rate={_compact_pct(profile.get('invalidation_rate'))}",
            f"mixed_rate={_compact_pct(profile.get('mixed_rate'))}",
        ]
        notes = _compact_list(profile.get("data_quality_notes"), limit=2)
        lessons = _compact_list(profile.get("recent_lessons"), limit=2)
        line = (
            f"- {symbol} {market_type} {horizon} relation={relation} "
            f"bias={action_bias} sample_size={sample_size}; "
            f"{'; '.join(rates)}"
        )
        if notes:
            line += f"; notes={notes}"
        if lessons:
            line += f"; lessons={lessons}"
        lines.append(line[:700])
    return "\n".join(lines) if len(lines) > 1 else ""


def _compact_pct(value: object) -> str:
    if value is None:
        return "n/a"
    if not isinstance(value, (int, float, str)):
        return "n/a"
    try:
        return f"{float(value) * 100:.0f}%"
    except (TypeError, ValueError):
        return "n/a"


def _compact_list(value: object, *, limit: int) -> str:
    if not isinstance(value, list):
        return ""
    return "; ".join(
        _compact_text(item) for item in value[:limit] if _compact_text(item)
    )


def _compact_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:180]


def _date_grounding_instruction(analysis_date: str) -> str:
    return (
        f"Analysis date: {analysis_date or 'unknown'}.\n"
        "Date/source grounding: Use the analysis date only as the run anchor. "
        "Do not attach a specific calendar date to a level, breakout, support, "
        "resistance, or catalyst unless that exact date appears in the supplied "
        "source artifacts. If a source gives a level without a date, refer to it "
        "as a prior breakout/support/resistance level or evidence-backed level "
        "instead of naming a day."
    )


def _template_field_instructions(
    setup_type: str | None,
    *,
    validation_result: dict[str, Any] | None = None,
) -> str:
    """Build prompt instructions for template required/optional fields.

    When *validation_result* carries a degradation, the instructions
    include a clear warning and switch to agent_debate guidance.
    """
    effective = (
        validation_result.get("effective_setup_type", setup_type)
        if validation_result
        else setup_type
    )
    if not effective or effective == "agent_debate":
        if validation_result and validation_result.get("is_degraded"):
            return (
                f"\n[WARNING] Template '{setup_type}' was requested but required fields "
                f"are missing: {', '.join(validation_result.get('missing_fields', []))}. "
                f"Using generic agent_debate template instead. "
                f"Do NOT invent values for missing fields; use the available context only."
            )
        return ""

    template = TemplateRegistry.get(effective)
    if template is None:
        return ""

    lines = [
        f"\nWhen setup_type is '{effective}', you MUST include these fields in every scenario:"
    ]
    for field in template.required_fields:
        lines.append(f"  - {field.name}: {field.description}")
    if template.optional_fields:
        lines.append("Optional fields (include when data is available):")
        for field in template.optional_fields:
            lines.append(f"  - {field.name}: {field.description}")

    # If some required fields are missing, warn but don't degrade if coverage is sufficient
    if validation_result and validation_result.get("missing_fields"):
        missing = validation_result["missing_fields"]
        lines.append(
            f"\nNote: The following required fields are missing from the context "
            f"and should be derived conservatively: {', '.join(missing)}"
        )

    return "\n".join(lines)


def create_scenario_planner(llm, config=None):
    """Create a scenario planner that emits a structured ``ScenarioPlan`` when supported.

    **Phase 5 enforcement**: Before calling the LLM, the planner validates
    that the requested template's required fields are present in the context.
    If too many are missing (< 50% coverage), the planner degrades to the
    generic ``agent_debate`` template and emits a clear warning.
    """

    structured_llm = bind_structured(llm, ScenarioPlan, "ScenarioPlanner")

    def scenario_node(state, name):
        company_name = state["company_of_interest"]
        analysis_date = str(state.get("trade_date") or state.get("analysis_date") or "")
        instrument_context = build_instrument_context(company_name)
        current_price_context = build_current_price_context(state)
        investment_plan = state.get("investment_plan", "")
        pm_decision = state.get("final_trade_decision", "") or ""
        scenario_handoff = _render_scenario_continuity_handoff(
            state.get("scenario_continuity_handoff")
        )
        scenario_reliability = render_scenario_reliability_digest(
            state.get("scenario_reliability_digest")
            or state.get("scenario_reliability_profiles")
        )
        scenario_feedback = render_scenario_feedback_playbook(
            state.get("latest_continuity_context")
        )

        research_reports = {
            k: state.get(k, "")
            for k in (
                "market_report",
                "sentiment_report",
                "news_report",
                "fundamentals_report",
            )
        }

        reports_block = "\n\n".join(
            f"=== {k} ===\n{guard_untrusted_context(k, v)}"
            for k, v in research_reports.items()
            if v
        )
        source_evidence = _source_evidence_text(state, research_reports)
        date_grounding = _date_grounding_instruction(analysis_date)
        language_instruction = get_language_instruction(config=config or {})

        # --- Phase 5: pre-LLM template field validation ---
        requested_setup = state.get("setup_type")
        context_values = _build_template_context(state)
        validation = TemplateRegistry.validate_template_context(
            requested_setup,
            context_values,
            required_coverage_threshold=0.5,
        )
        effective_setup = validation["effective_setup_type"]

        if validation["is_degraded"]:
            logger.warning(
                "ScenarioPlanner: template degraded for '%s': %s",
                requested_setup,
                validation["degrade_reason"],
            )

        field_instructions = _template_field_instructions(
            requested_setup, validation_result=validation
        )

        if structured_llm is not None:
            try:
                horizon_plans = []
                structured_successes = 0
                for horizon in ScenarioHorizon:
                    messages = [
                        {
                            "role": "system",
                            "content": (
                                "You are a Scenario Planning Analyst. Produce one "
                                "conditional market scenario for the requested horizon "
                                "(not a trade command). The scenario must read like a "
                                "decision card: named scenario first, concise evidence, "
                                "concrete watch triggers, action, and impact on thesis. "
                                "Never use probability as the scenario title, and never "
                                "issue imperative buy/sell commands. Populate "
                                "scenario_recommendation when enough structure exists: "
                                "use wait/consider/review guidance, explicit hard_gates, "
                                "blocking_reasons, evidence_refs, invalidation_conditions, "
                                "and an evaluation_window. If the scenario is not "
                                "actionable, set action to wait or review and explain the "
                                "blockers instead of inventing an entry. Crowded long "
                                "positioning is long-liquidation risk, not short-squeeze "
                                "evidence; short squeeze requires crowded short positioning "
                                "or short liquidations. Do not cite whale accumulation, "
                                "exchange inflow/outflow, active addresses, or wallet flows "
                                "unless a source artifact explicitly provides those metrics."
                                f"{language_instruction}"
                                f"\n\n{date_grounding}"
                                f"\n\nHorizon policy: {horizon.value}. "
                                f"{_HORIZON_POLICIES[horizon]} "
                                f"Set horizon to {horizon.value} and timeframe_label "
                                f"to {_HORIZON_WINDOWS[horizon]}."
                                f"{field_instructions}"
                            ),
                        },
                        {
                            "role": "user",
                            "content": (
                                f"Generate the {horizon.value} structured scenario for {company_name}. "
                                f"{instrument_context}\n\n"
                                f"{current_price_context}\n\n"
                                f"{date_grounding}\n\n"
                                f"{_TEMPLATE_LINE}\n\n"
                                "Return a ScenarioPlan with exactly one scenario for this "
                                "horizon. The parent planner will normalize the final "
                                "short/mid/long plan. Use the current reports, investment "
                                "plan, and Portfolio Manager decision as the primary "
                                "evidence layer. Do not use raw continuity memory.\n\n"
                                f"{scenario_handoff}\n\n"
                                f"{scenario_feedback}\n\n"
                                f"{scenario_reliability}\n\n"
                                "Portfolio Manager decision (truncated):\n"
                                f"{guard_untrusted_context('portfolio_manager_decision', pm_decision)}\n\n"
                                f"Investment plan:\n{guard_untrusted_context('investment_plan', investment_plan)}\n\n"
                                f"Research context:\n{reports_block}"
                            ),
                        },
                    ]
                    try:
                        horizon_plans.append(structured_llm.invoke(messages))
                        structured_successes += 1
                    except Exception as exc:
                        logger.warning(
                            "ScenarioPlanner: %s structured horizon failed (%s); using horizon fallback",
                            horizon.value,
                            exc,
                        )
                        horizon_plans.append(
                            ScenarioPlan(setup_type=effective_setup, scenarios=[])
                        )
                if structured_successes == 0:
                    raise RuntimeError("all structured horizon calls failed")
                plan = _normalize_horizon_plan(
                    horizon_plans,
                    setup_type=effective_setup,
                    analysis_date=analysis_date,
                    research_reports=research_reports,
                    state=state,
                )
                plan = _ground_scenario_plan_dates(
                    plan,
                    evidence_text=source_evidence,
                    analysis_date=analysis_date,
                )
                plan = _enrich_scenario_plan_provenance(
                    plan,
                    analysis_date=analysis_date,
                    research_reports=research_reports,
                    state=state,
                )
                markdown = render_scenario_plan(plan)
                return {
                    "messages": [AIMessage(content=markdown)],
                    "scenario_plan": markdown,
                    "scenario_plan_json": plan.model_dump_json(),
                    "sender": name,
                    # Phase 5: persist template enforcement metadata
                    "setup_type": effective_setup,
                    "requested_setup_type": requested_setup,
                    "template_degraded": validation["is_degraded"],
                    "missing_template_fields": validation["missing_fields"],
                }
            except Exception as exc:
                logger.warning(
                    "ScenarioPlanner: structured output failed (%s); using free text",
                    exc,
                )

        fallback_prompt = f"""You are a Scenario Planning Analyst. Generate 2-3 alternative
future market scenarios for {company_name}. {instrument_context}

{current_price_context}

{date_grounding}

For each scenario, describe:
- Scenario name
- Key market conditions and catalysts
- Evidence chips and watch triggers
- Probability assessment
- Impact on the investment thesis
- Relationship to the current thesis: supports / challenges / invalidates / neutral
- Recommended response (review / watch / reassess - not buy/sell commands)
- Source, timeframe, and as_of when available
{language_instruction}
Keep the section labels above exactly in English for persistence parsing; write
the scenario names and field content in the requested output language.

For providers that return free text instead of native structured output, write
the readable Markdown scenario map first, then append this exact
machine-readable block. Keep exactly three scenarios: one short_term, one
mid_term, and one long_term. Use valid JSON only inside the block; no comments,
tables, ellipses, or trailing commas. Field names must stay in English, while
field values may use the requested output language.

SCENARIO_PLAN_JSON:
```json
{{
  "setup_type": "{effective_setup or "agent_debate"}",
  "scenarios": [
    {{
      "horizon": "short_term",
      "timeframe_label": "24-72h",
      "scenario_name": "named short-term scenario",
      "direction": "neutral",
      "thesis_impact": "medium",
      "relation_to_thesis": "challenges",
      "condition": "specific short-term trigger with observed levels or thresholds",
      "expected_behavior": "expected market behavior if the trigger occurs",
      "evidence": ["metric or source-backed evidence chip"],
      "watch_triggers": ["observable trigger to monitor"],
      "impact_on_thesis": "how this branch affects the current thesis",
      "probability_band": "medium",
      "invalidation": "specific condition invalidating this branch",
      "risk_factors": ["risk or contradiction"],
      "suggested_action": "watch confirmation, not an exchange order",
      "as_of": "{analysis_date or "not recorded"}",
      "timeframe": "4H | 1D | 1W | not recorded",
      "source": ["market_report"]
    }},
    {{
      "horizon": "mid_term",
      "timeframe_label": "1-3w",
      "scenario_name": "named medium-term scenario",
      "direction": "neutral",
      "thesis_impact": "medium",
      "relation_to_thesis": "supports",
      "condition": "specific medium-term trigger with observed levels or thresholds",
      "expected_behavior": "expected market behavior if the trigger occurs",
      "evidence": ["metric or source-backed evidence chip"],
      "watch_triggers": ["observable trigger to monitor"],
      "impact_on_thesis": "how this branch affects the current thesis",
      "probability_band": "medium",
      "invalidation": "specific condition invalidating this branch",
      "risk_factors": ["risk or contradiction"],
      "suggested_action": "watch confirmation, not an exchange order",
      "as_of": "{analysis_date or "not recorded"}",
      "timeframe": "1D | 1W | not recorded",
      "source": ["market_report"]
    }},
    {{
      "horizon": "long_term",
      "timeframe_label": "1-3m",
      "scenario_name": "named long-term scenario",
      "direction": "neutral",
      "thesis_impact": "medium",
      "relation_to_thesis": "invalidates",
      "condition": "specific long-term structural trigger with observed levels or thresholds",
      "expected_behavior": "expected market behavior if the trigger occurs",
      "evidence": ["metric or source-backed evidence chip"],
      "watch_triggers": ["observable trigger to monitor"],
      "impact_on_thesis": "how this branch affects the current thesis",
      "probability_band": "low",
      "invalidation": "specific condition invalidating this branch",
      "risk_factors": ["risk or contradiction"],
      "suggested_action": "review thesis, not an exchange order",
      "as_of": "{analysis_date or "not recorded"}",
      "timeframe": "1D | 1W | not recorded",
      "source": ["market_report"]
    }}
  ]
}}
```

{_TEMPLATE_LINE}

Base your scenarios on the research reports and investment plan below.

{scenario_handoff}

{scenario_feedback}

{scenario_reliability}

Research Reports:
{guard_untrusted_context("research_reports", reports_block)}

Investment Plan:
{guard_untrusted_context("investment_plan", investment_plan)}
"""
        response = llm.invoke(fallback_prompt)
        content = response.content if hasattr(response, "content") else str(response)
        content = _replace_unsupported_calendar_dates(
            content,
            evidence_text=source_evidence,
            analysis_date=analysis_date,
        )
        plan = _validated_free_text_json_plan(
            content,
            setup_type=effective_setup,
            analysis_date=analysis_date,
            research_reports=research_reports,
            state=state,
            source_evidence=source_evidence,
        )
        if plan is not None:
            markdown = render_scenario_plan(plan)
            return {
                "messages": [AIMessage(content=markdown)],
                "scenario_plan": markdown,
                "scenario_plan_json": plan.model_dump_json(),
                "sender": name,
                # Phase 5: persist template enforcement metadata even in fallback
                "setup_type": effective_setup,
                "requested_setup_type": requested_setup,
                "template_degraded": validation["is_degraded"],
                "missing_template_fields": validation["missing_fields"],
            }
        stripped_content = _strip_scenario_plan_json_block(content)
        return {
            "messages": [AIMessage(content=stripped_content)],
            "scenario_plan": stripped_content,
            "scenario_plan_json": "",
            "sender": name,
            # Phase 5: persist template enforcement metadata even in fallback
            "setup_type": effective_setup,
            "requested_setup_type": requested_setup,
            "template_degraded": validation["is_degraded"],
            "missing_template_fields": validation["missing_fields"],
        }

    return functools.partial(scenario_node, name="ScenarioPlanner")
