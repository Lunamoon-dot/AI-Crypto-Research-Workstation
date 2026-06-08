"""Scenario planner: template-guided structured scenarios for thesis planning.

Phase 5 enforcement: validates template required fields before calling the
LLM.  When critical fields are missing the planner degrades to the generic
``agent_debate`` template and emits a clear warning.
"""

from __future__ import annotations

import functools
import logging
import re
from datetime import datetime

from langchain_core.messages import AIMessage

from luna_workstation.agents.schemas import ScenarioPlan, render_scenario_plan
from luna_workstation.agents.utils.agent_utils import (
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
_MAX_STRUCTURED_SCENARIOS = 4

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


def _build_template_context(state: dict) -> dict[str, str]:
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


def _source_evidence_text(state: dict, research_reports: dict[str, str]) -> str:
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
    return plan.model_copy(
        update={"scenarios": grounded_scenarios[:_MAX_STRUCTURED_SCENARIOS]}
    )


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
    labels = [name for name, value in research_reports.items() if str(value or "").strip()]
    return labels[:3]


def _enrich_scenario_plan_provenance(
    plan: ScenarioPlan,
    *,
    analysis_date: str,
    research_reports: dict[str, str],
    state: dict,
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
    return plan.model_copy(update={"scenarios": enriched[:_MAX_STRUCTURED_SCENARIOS]})


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
    validation_result: dict | None = None,
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
        investment_plan = state.get("investment_plan", "")
        pm_decision = state.get("final_trade_decision", "") or ""

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

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a Scenario Planning Analyst. Produce conditional market "
                    "scenarios (not trade commands). Each scenario must read like a "
                    "decision card: named scenario first, concise evidence, concrete "
                    "watch triggers, action, and impact on thesis. Never use probability "
                    "as the scenario title, and never issue imperative buy/sell commands."
                    f"{language_instruction}"
                    f"\n\n{date_grounding}"
                    f"{field_instructions}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Generate a structured scenario map for {company_name}. "
                    f"{instrument_context}\n\n"
                    f"{date_grounding}\n\n"
                    f"{_TEMPLATE_LINE}\n\n"
                    f"Produce exactly 3-4 scenarios (each with required template fields if setup_type is specified) covering: directional confirmation, "
                    f"invalidation / adverse path, neutral/wait, and (if debate shows conflict) "
                    f"a contradiction branch. Use scenario names as titles; keep summaries short; "
                    f"express watch conditions as checklist triggers; include source, timeframe, "
                    f"and as_of for evidence when available.\n\n"
                    "Portfolio Manager decision (truncated):\n"
                    f"{guard_untrusted_context('portfolio_manager_decision', pm_decision)}\n\n"
                    f"Investment plan:\n{guard_untrusted_context('investment_plan', investment_plan)}\n\n"
                    f"Research context:\n{reports_block}"
                ),
            },
        ]

        if structured_llm is not None:
            try:
                plan = structured_llm.invoke(messages)
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

{date_grounding}

For each scenario, describe:
- Scenario name
- Key market conditions and catalysts
- Evidence chips and watch triggers
- Probability assessment
- Impact on the investment thesis
- Recommended response (review / watch / reassess - not buy/sell commands)
- Source, timeframe, and as_of when available
{language_instruction}
Keep the section labels above exactly in English for persistence parsing; write
the scenario names and field content in the requested output language.

{_TEMPLATE_LINE}

Base your scenarios on the research reports and investment plan below.

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
        return {
            "messages": [AIMessage(content=content)],
            "scenario_plan": content,
            "scenario_plan_json": "",
            "sender": name,
            # Phase 5: persist template enforcement metadata even in fallback
            "setup_type": effective_setup,
            "requested_setup_type": requested_setup,
            "template_degraded": validation["is_degraded"],
            "missing_template_fields": validation["missing_fields"],
        }

    return functools.partial(scenario_node, name="ScenarioPlanner")
