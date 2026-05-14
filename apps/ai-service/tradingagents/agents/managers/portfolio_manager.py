"""Portfolio Manager: synthesises the risk-analyst debate into the final thesis.

Uses LangChain's ``with_structured_output`` so the LLM produces a typed
``PortfolioDecision`` directly, in a single call.  The result is rendered
back to markdown for storage in ``final_trade_decision`` so memory log,
CLI display, and saved reports continue to consume the same shape they do
today.  When a provider does not expose structured output, the agent falls
back gracefully to free-text generation.
"""

from __future__ import annotations

from tradingagents.agents.schemas import PortfolioDecision, render_pm_decision
from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    get_language_instruction,
    guard_untrusted_context,
)
from tradingagents.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)
from tradingagents.agents.utils.thesis_json import (
    extract_trade_thesis_json,
    strip_trade_thesis_json_block,
)


def _get_feedback_context(config) -> str:
    """Load past performance feedback for injection into the PM prompt."""
    if config is None:
        return ""
    eval_cfg = config.get("evaluation", {})
    if not eval_cfg.get("feedback_enabled", True):
        return ""
    try:
        from tradingagents.services.performance_tracker import PerformanceTracker

        tracker = PerformanceTracker(config)
        ctx = tracker.build_feedback_context()
        return ctx
    except Exception:
        return ""


def create_portfolio_manager(llm, config=None):
    structured_llm = bind_structured(llm, PortfolioDecision, "Portfolio Manager")

    def portfolio_manager_node(state) -> dict:
        instrument_context = build_instrument_context(state["company_of_interest"])

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

        feedback_context = guard_untrusted_context(
            "performance_feedback",
            _get_feedback_context(config),
        )

        prompt = f"""As the Portfolio Manager, synthesize the risk analysts' debate and deliver the final research thesis stance.

{instrument_context}

---

Market type: {market_type}

**Research Stance Scale** (use exactly one):
- **Buy**: Strong bullish thesis; prioritize bullish setup review
- **Overweight**: Favorable outlook; increase attention as confirmation improves
- **Hold**: Balanced thesis; keep on watch and reassess new evidence
- **Underweight**: Cautious thesis; reduce conviction and reassess exposure
- **Sell**: Strong bearish thesis; prefer bearish or avoid-setup review

**Context:**
- Research Manager's investment plan: {guard_untrusted_context("research_plan", research_plan)}
- Setup Planner's proposal: {guard_untrusted_context("setup_proposal", setup_proposal)}
{lessons_line}
{feedback_context}

**Risk Analysts Debate History:**
{guard_untrusted_context("risk_debate_history", history)}

---

Be decisive and ground every conclusion in specific evidence from the analysts.
This is a research stance for manual review, not an exchange order or automated execution instruction.
For spot, include accumulation/DCA/allocation-risk notes where relevant. For perp, include funding, OI, liquidation, leverage cap, invalidation distance, and margin-risk notes where relevant; list missing perp data instead of overstating confidence.

For providers that return free text instead of native structured output, write the readable Markdown decision first, then append this exact machine-readable block:

TRADE_THESIS_JSON:
```json
{{
  "rating": "Buy | Overweight | Hold | Underweight | Sell",
  "direction": "long | short | watch | avoid | neutral",
  "confidence": 0.0,
  "market_type": "spot | perp",
  "action_summary": "one short UI research stance summary",
  "upside_catalyst": "specific condition that improves the thesis",
  "invalidation": "specific condition that invalidates the thesis",
  "key_reasons": ["reason 1", "reason 2", "reason 3"],
  "risks": ["risk 1", "risk 2"],
  "spot_notes": "spot-specific notes or empty string",
  "perp_notes": "perp-specific notes or empty string",
  "missing_data": ["missing data item"]
}}
```
Set `confidence` to the final thesis confidence from 0.0 to 1.0 after weighing debate consensus, quant baseline, missing data, conflict, and risk; do not copy the quant confidence mechanically. Use valid JSON only inside the block; no comments or trailing commas.{get_language_instruction(config=config)}"""

        rendered_trade_decision = invoke_structured_or_freetext(
            structured_llm,
            llm,
            prompt,
            render_pm_decision,
            "Portfolio Manager",
        )
        final_trade_summary_json = extract_trade_thesis_json(rendered_trade_decision)
        final_trade_decision = (
            strip_trade_thesis_json_block(rendered_trade_decision)
            if final_trade_summary_json
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
