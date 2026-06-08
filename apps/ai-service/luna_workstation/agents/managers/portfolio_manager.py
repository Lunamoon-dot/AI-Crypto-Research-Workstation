"""Portfolio Manager: synthesises the risk-analyst debate into the final thesis.

Uses LangChain's ``with_structured_output`` so the LLM produces a typed
``PortfolioDecision`` directly, in a single call.  The result is rendered
back to markdown for storage in ``final_trade_decision`` so memory log,
CLI display, and saved reports continue to consume the same shape they do
today.  When a provider does not expose structured output, the agent falls
back gracefully to free-text generation.
"""

from __future__ import annotations

import json
import re

from luna_workstation.agents.schemas import PortfolioDecision, render_pm_decision
from luna_workstation.agents.utils.agent_utils import (
    build_instrument_context,
    build_current_price_context,
    get_language_instruction,
    guard_untrusted_context,
)
from luna_workstation.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)
from luna_workstation.agents.utils.rating import normalize_rating, parse_rating_label
from luna_workstation.agents.utils.thesis_json import (
    extract_trade_thesis_json,
    strip_trade_thesis_json_block,
)
from luna_workstation.exceptions import LLMOutputError


_TEXT_LIST_SPLIT_RE = re.compile(r"[;\n\u2022]|\band\b|,(?=\s+)", re.IGNORECASE)


def _extract_markdown_field(text: str, field: str) -> str:
    field_label = re.escape(field)
    pattern = (
        rf"^\s*(?:[-*]\s*)?\*{{0,2}}{field_label}"
        r"\s*(?:Zones?|Levels?|Prices?|Condition)?\*{0,2}"
        r"\s*[:\-\u2013\u2014]\s*(.+?)\s*$"
    )
    match = re.search(pattern, text or "", re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip() if match else ""


def _extract_markdown_list_field(text: str, field: str) -> list[str]:
    value = _extract_markdown_field(text, field)
    if not value:
        return []
    return [part.strip() for part in _TEXT_LIST_SPLIT_RE.split(value) if part.strip()]


def _direction_for_rating(rating: str) -> str:
    return {
        "Buy": "long",
        "Overweight": "long",
        "Hold": "watch",
        "Underweight": "avoid",
        "Sell": "short",
    }.get(rating, "watch")


def _rating_from_artifacts(*texts: str) -> str:
    for text in texts:
        rating = parse_rating_label(text)
        if rating:
            return rating
        for field in ("Research Stance", "Setup Stance", "Stance", "Action"):
            rating = normalize_rating(_extract_markdown_field(text, field))
            if rating:
                return rating
    return "Hold"


def _deterministic_pm_fallback(
    *,
    symbol: str,
    market_type: str,
    research_plan: str,
    setup_proposal: str,
    risk_history: str,
    error: Exception,
) -> str:
    rating = _rating_from_artifacts(research_plan, setup_proposal, risk_history)
    confirmation = _extract_markdown_field(
        setup_proposal,
        "Confirmation",
    )
    invalidation = _extract_markdown_field(setup_proposal, "Invalidation")
    target_zones = _extract_markdown_list_field(
        setup_proposal,
        "Target",
    ) or _extract_markdown_list_field(setup_proposal, "Objective")
    missing_data = _extract_markdown_list_field(setup_proposal, "Missing Data")
    missing_data.append(f"Portfolio Manager LLM unavailable: {type(error).__name__}.")
    lines = [
        f"**Portfolio Manager deterministic fallback: {symbol} ({market_type})**",
        "",
        f"**Rating**: {rating}",
        "",
        "**Research Summary**: Portfolio Manager LLM unavailable; "
        "using the Research Manager stance, Setup Planner levels, and risk debate.",
        "",
        "**Investment Thesis**: This is a deterministic fallback assembled from "
        "completed upstream artifacts after the Portfolio Manager model call failed.",
    ]
    if confirmation:
        lines.extend(["", f"**Confirmation**: {confirmation}"])
    if invalidation:
        lines.extend(["", f"**Invalidation**: {invalidation}"])
    if target_zones:
        lines.extend(["", f"**Target Zones**: {'; '.join(target_zones)}"])
    if missing_data:
        lines.extend(["", f"**Missing Data**: {'; '.join(missing_data)}"])
    return "\n".join(lines)


def _synthesize_trade_summary_json(text: str, *, market_type: str) -> str:
    """Build the UI summary contract when free-text fallback omits JSON."""
    rating = parse_rating_label(text)
    if rating is None:
        return ""
    payload = {
        "rating": rating,
        "direction": _direction_for_rating(rating),
        "confidence": None,
        "market_type": market_type,
        "action_summary": _extract_markdown_field(text, "Research Summary")
        or _extract_markdown_field(text, "Executive Summary")
        or _extract_markdown_field(text, "Stance"),
        "confirmation_condition": _extract_markdown_field(text, "Confirmation"),
        "upside_catalyst": _extract_markdown_field(text, "Upside Catalyst"),
        "invalidation": _extract_markdown_field(text, "Invalidation"),
        "target_zones": _extract_markdown_list_field(text, "Target"),
        "key_reasons": _extract_markdown_list_field(text, "Key Reasons"),
        "risks": _extract_markdown_list_field(text, "Risks"),
        "monitor_next": _extract_markdown_list_field(text, "Monitor Next"),
        "supporting_evidence": [],
        "spot_notes": _extract_markdown_field(text, "Spot Notes"),
        "perp_notes": _extract_markdown_field(text, "Perp Notes"),
        "missing_data": _extract_markdown_list_field(text, "Missing Data"),
    }
    return json.dumps(payload, ensure_ascii=False)


def _get_feedback_context(config) -> str:
    """Load past performance feedback for injection into the PM prompt."""
    if config is None:
        return ""
    eval_cfg = config.get("evaluation", {})
    if not eval_cfg.get("feedback_enabled", True):
        return ""
    try:
        from luna_workstation.services.performance_tracker import PerformanceTracker

        tracker = PerformanceTracker(config)
        ctx = tracker.build_feedback_context()
        return ctx
    except Exception:
        return ""


def _render_latest_continuity_context(context: object) -> str:
    if not isinstance(context, dict) or not context:
        return ""
    rendered = json.dumps(context, ensure_ascii=True, indent=2, sort_keys=True)
    return (
        "- Latest Research Continuity prior memory for the same workspace/symbol/market type:\n"
        f"{guard_untrusted_context('latest_continuity_context', rendered)}\n"
        "Treat this only as prior memory. Do not treat it as current evidence. "
        "Use it only to explain whether the current thesis continues, weakens, "
        "invalidates, or supersedes the prior thesis.\n"
        "If you cite this prior memory in supporting_evidence, set "
        "`source_artifact` to `research_continuity`.\n"
    )


def create_portfolio_manager(llm, config=None):
    structured_llm = bind_structured(llm, PortfolioDecision, "Portfolio Manager")

    def portfolio_manager_node(state) -> dict:
        instrument_context = build_instrument_context(state["company_of_interest"])
        current_price_context = build_current_price_context(state)

        history = state["risk_debate_state"]["history"]
        risk_debate_state = state["risk_debate_state"]
        research_plan = state["investment_plan"]
        setup_proposal = state["trader_investment_plan"]
        market_type = (
            state.get("market_type") or (config or {}).get("market_type") or "spot"
        )

        past_context = state.get("past_context", "")
        lessons_line = (
            "- Lessons from prior decisions and outcomes:\n"
            f"{guard_untrusted_context('past_context', past_context)}\n"
            if past_context
            else ""
        )
        continuity_line = _render_latest_continuity_context(
            state.get("latest_continuity_context")
        )

        feedback_context = guard_untrusted_context(
            "performance_feedback",
            _get_feedback_context(config),
        )

        prompt = f"""As the Portfolio Manager, synthesize the risk analysts' debate and deliver the final research thesis stance.

{instrument_context}

---

Market type: {market_type}

{current_price_context}

**Research Stance Scale** (use exactly one):
- **Buy**: Strong bullish thesis; prioritize bullish setup review
- **Overweight**: Favorable outlook; increase attention as confirmation improves
- **Hold**: Balanced thesis; keep on watch and reassess new evidence
- **Underweight**: Cautious thesis; reduce or avoid exposure; do not imply a short unless the rating is Sell
- **Sell**: Strong bearish thesis; prefer bearish or avoid-setup review

**Context:**
- Research Manager's investment plan: {guard_untrusted_context("research_plan", research_plan)}
- Setup Planner's proposal: {guard_untrusted_context("setup_proposal", setup_proposal)}
{lessons_line}
{continuity_line}
{feedback_context}

**Risk Analysts Debate History:**
{guard_untrusted_context("risk_debate_history", history)}

---

Be decisive and ground every conclusion in specific evidence from the analysts.
Every thesis must explicitly state why the stance is bullish/bearish/watch, what condition confirms it, and what condition invalidates it.
This is a research stance for manual review, not an exchange order or automated execution instruction.
Analyst reports and the risk debate remain the current evidence layer.
For spot, include accumulation/DCA/allocation-risk notes where relevant. For perp, include funding, OI, liquidation, leverage cap, invalidation distance, and margin-risk notes where relevant; list missing perp data instead of overstating confidence.

For providers that return free text instead of native structured output, write the readable Markdown decision first, then append this exact machine-readable block. Keep rating and direction consistent: Buy/Overweight = long, Hold = watch or neutral, Underweight = avoid, Sell = short.

TRADE_THESIS_JSON:
```json
{{
  "rating": "Buy | Overweight | Hold | Underweight | Sell",
  "direction": "long | short | watch | avoid | neutral",
  "confidence": 0.0,
  "market_type": "spot | perp",
  "action_summary": "one short UI research stance summary",
  "confirmation_condition": "specific condition that confirms the thesis",
  "upside_catalyst": "specific condition that improves the thesis",
  "invalidation": "specific condition that invalidates the thesis",
  "key_reasons": [
    {{
      "text": "reason 1",
      "supporting_evidence": [
        {{
          "text": "specific observed, reasoning, or missing-data evidence",
          "evidence_kind": "observed | reasoning | missing",
          "source_artifact": "market_snapshot | signal_snapshot | trade_thesis | agent_opinion | research_debate | research_run | research_continuity | external_report | unknown",
          "source_field": "optional source field",
          "strength": "low | medium | high | unknown"
        }}
      ]
    }}
  ],
  "risks": [
    {{
      "text": "risk 1",
      "supporting_evidence": []
    }}
  ],
  "monitor_next": [
    {{
      "text": "watchpoint 1",
      "supporting_evidence": []
    }}
  ],
  "supporting_evidence": [],
  "spot_notes": "spot-specific notes or empty string",
  "perp_notes": "perp-specific notes or empty string",
  "missing_data": ["missing data item"]
}}
```
Set `confidence` to the final thesis confidence from 0.0 to 1.0 after weighing debate consensus, quant baseline, missing data, conflict, and risk; do not copy the quant confidence mechanically. Use valid JSON only inside the block; no comments or trailing commas.{get_language_instruction(config=config)}"""

        try:
            rendered_trade_decision = invoke_structured_or_freetext(
                structured_llm,
                llm,
                prompt,
                render_pm_decision,
                "Portfolio Manager",
            )
        except LLMOutputError as exc:
            rendered_trade_decision = _deterministic_pm_fallback(
                symbol=str(state.get("company_of_interest") or "UNKNOWN"),
                market_type=str(market_type),
                research_plan=research_plan,
                setup_proposal=setup_proposal,
                risk_history=history,
                error=exc,
            )
        final_trade_summary_json = extract_trade_thesis_json(rendered_trade_decision)
        if not final_trade_summary_json:
            final_trade_summary_json = _synthesize_trade_summary_json(
                rendered_trade_decision,
                market_type=str(market_type),
            )
        final_trade_decision = (
            strip_trade_thesis_json_block(rendered_trade_decision)
            if extract_trade_thesis_json(rendered_trade_decision)
            else rendered_trade_decision
        )

        new_risk_debate_state = {
            "judge_decision": final_trade_decision,
            "history": risk_debate_state["history"],
            "aggressive_history": risk_debate_state["aggressive_history"],
            "conservative_history": risk_debate_state["conservative_history"],
            "neutral_history": risk_debate_state["neutral_history"],
            "latest_speaker": "Judge",
            "current_aggressive_response": risk_debate_state[
                "current_aggressive_response"
            ],
            "current_conservative_response": risk_debate_state[
                "current_conservative_response"
            ],
            "current_neutral_response": risk_debate_state["current_neutral_response"],
            "count": risk_debate_state["count"],
        }

        return {
            "risk_debate_state": new_risk_debate_state,
            "final_trade_decision": final_trade_decision,
            "final_trade_summary_json": final_trade_summary_json,
        }

    return portfolio_manager_node
