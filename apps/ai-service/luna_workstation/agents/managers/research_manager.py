"""Research Manager: turns the bull/bear debate into a structured research plan."""

from __future__ import annotations

from luna_workstation.agents.schemas import ResearchPlan, render_research_plan
from luna_workstation.agents.utils.agent_utils import (
    build_instrument_context,
    guard_untrusted_context,
)
from luna_workstation.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)


def create_research_manager(llm):
    structured_llm = bind_structured(llm, ResearchPlan, "Research Manager")

    def research_manager_node(state) -> dict:
        instrument_context = build_instrument_context(state["company_of_interest"])
        history = state["investment_debate_state"].get("history", "")

        investment_debate_state = state["investment_debate_state"]

        prompt = f"""As the Research Manager and debate facilitator, your role is to critically evaluate this round of debate and deliver a clear research stance for the Setup Planner.

{instrument_context}

---

**Quantitative Baseline**: The Market Research Report fed to both debaters contains a pre-computed quantitative signal from a deterministic SignalEngine. Weigh the debate arguments against this baseline — a strong quant signal should NOT be overridden by weak qualitative arguments, and vice versa.

---

**Research Stance Scale** (use exactly one):
- **Buy**: Strong conviction in the bullish thesis; prioritize bullish setup review
- **Overweight**: Constructive view; increase attention as evidence confirms
- **Hold**: Balanced view; keep the thesis on watch and reassess new evidence
- **Underweight**: Cautious view; reduce conviction in bullish setups and reassess exposure
- **Sell**: Strong conviction in the bearish thesis; prefer bearish or avoid-setup review

Commit to a clear stance whenever the debate's strongest arguments warrant one; reserve Hold for situations where the evidence on both sides is genuinely balanced.

---

**Debate History:**
{guard_untrusted_context("investment_debate_history", history)}"""

        investment_plan = invoke_structured_or_freetext(
            structured_llm,
            llm,
            prompt,
            render_research_plan,
            "Research Manager",
        )

        new_investment_debate_state = {
            "judge_decision": investment_plan,
            "history": investment_debate_state.get("history", ""),
            "bear_history": investment_debate_state.get("bear_history", ""),
            "bull_history": investment_debate_state.get("bull_history", ""),
            "current_response": investment_plan,
            "count": investment_debate_state["count"],
        }

        return {
            "investment_debate_state": new_investment_debate_state,
            "investment_plan": investment_plan,
        }

    return research_manager_node
