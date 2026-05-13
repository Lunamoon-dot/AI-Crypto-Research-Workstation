"""Tests for structured-output agents (Setup Planner and Research Manager).

The Portfolio Manager has its own coverage in tests/test_memory_log.py
(which exercises the full memory-log → PM injection cycle).  This file
covers the parallel schemas, render functions, and graceful-fallback
behavior we added for the Setup Planner and Research Manager so all three
decision-making agents share the same shape.
"""

from unittest.mock import MagicMock

import pytest

from tradingagents.agents.managers.research_manager import create_research_manager
from tradingagents.agents.schemas import (
    MarketType,
    PortfolioRating,
    ResearchPlan,
    SetupAction,
    SetupProposal,
    TraderAction,
    TraderProposal,
    render_research_plan,
    render_setup_proposal,
    render_trader_proposal,
)
from tradingagents.agents.planners.setup_planner import (
    create_setup_planner,
    create_trader,
)


# ---------------------------------------------------------------------------
# Render functions
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestRenderSetupProposal:
    def test_minimal_required_fields(self):
        p = SetupProposal(action=SetupAction.HOLD, reasoning="Balanced setup; no edge.")
        md = render_setup_proposal(p)
        assert "**Market Type**: spot" in md
        assert "**Setup Stance**: Hold" in md
        assert "**Reasoning**: Balanced setup; no edge." in md
        assert "FINAL SETUP STANCE: **HOLD**" in md

    def test_spot_fields_included_when_present(self):
        p = SetupProposal(
            action=SetupAction.BUY,
            reasoning="Strong technicals + fundamentals.",
            entry_zone="188-192",
            invalidation="Daily close below 178",
            target_zones=["205", "220"],
            position_sizing="6% of portfolio",
            spot_notes="Use staged accumulation; no leverage.",
        )
        md = render_setup_proposal(p)
        assert "**Setup Stance**: Buy" in md
        assert "**Review Zone**: 188-192" in md
        assert "**Invalidation**: Daily close below 178" in md
        assert "**Objective Zones**: 205; 220" in md
        assert "**Conviction Context**: 6% of portfolio" in md
        assert "**Spot Notes**: Use staged accumulation; no leverage." in md
        assert "FINAL SETUP STANCE: **BUY**" in md

    def test_perp_fields_and_missing_data_render(self):
        p = SetupProposal(
            market_type=MarketType.PERP,
            action=SetupAction.SELL,
            reasoning="Funding is crowded and OI is deteriorating.",
            perp_notes="Cap leverage at 2x; avoid isolated margin.",
            missing_data=["liquidation heatmap"],
        )
        md = render_setup_proposal(p)
        assert "**Market Type**: perp" in md
        assert "**Perp Notes**: Cap leverage at 2x; avoid isolated margin." in md
        assert "**Missing Data**: liquidation heatmap" in md

    def test_legacy_alias_and_fields_map_to_setup_fields(self):
        p = TraderProposal(
            action=TraderAction.SELL,
            reasoning="Guidance cut.",
            entry_price=189.5,
            stop_loss=178.0,
            take_profit=160.0,
        )
        md = render_trader_proposal(p)
        assert "**Review Zone**: 189.5" in md
        assert "**Invalidation**: 178.0" in md
        assert "**Objective Zones**: 160.0" in md
        assert "FINAL SETUP STANCE: **SELL**" in md

    def test_optional_fields_omitted_when_absent(self):
        p = SetupProposal(action=SetupAction.SELL, reasoning="Guidance cut.")
        md = render_setup_proposal(p)
        assert "Review Zone" not in md
        assert "Invalidation" not in md
        assert "Conviction Context" not in md
        assert "FINAL SETUP STANCE: **SELL**" in md


@pytest.mark.unit
class TestRenderResearchPlan:
    def test_required_fields(self):
        p = ResearchPlan(
            recommendation=PortfolioRating.OVERWEIGHT,
            rationale="Bull case carried; tailwinds intact.",
            strategic_actions="Increase attention over two weeks; cap conviction at 5%.",
        )
        md = render_research_plan(p)
        assert "**Research Stance**: Overweight" in md
        assert "**Rationale**: Bull case carried" in md
        assert "**Review Focus**: Increase attention" in md

    def test_all_5_tier_ratings_render(self):
        for rating in PortfolioRating:
            p = ResearchPlan(
                recommendation=rating,
                rationale="r",
                strategic_actions="s",
            )
            md = render_research_plan(p)
            assert f"**Research Stance**: {rating.value}" in md


# ---------------------------------------------------------------------------
# Setup Planner agent: structured happy path + fallback
# ---------------------------------------------------------------------------


def _make_setup_state(market_type: str = "spot"):
    return {
        "company_of_interest": "NVDA",
        "market_type": market_type,
        "investment_plan": "**Research Stance**: Buy\n**Rationale**: ...\n**Review Focus**: ...",
    }


def _structured_setup_llm(captured: dict, proposal: SetupProposal | None = None):
    """Build a MagicMock LLM whose with_structured_output binding captures the
    prompt and returns a real SetupProposal so render_setup_proposal works.
    """
    if proposal is None:
        proposal = SetupProposal(
            action=SetupAction.BUY,
            reasoning="Strong setup.",
        )
    structured = MagicMock()
    structured.invoke.side_effect = lambda prompt: (
        captured.__setitem__("prompt", prompt) or proposal
    )
    llm = MagicMock()
    llm.with_structured_output.return_value = structured
    return llm


@pytest.mark.unit
class TestSetupPlannerAgent:
    def test_structured_path_produces_rendered_markdown(self):
        captured = {}
        proposal = SetupProposal(
            action=SetupAction.BUY,
            reasoning="AI capex cycle intact; institutional flows constructive.",
            entry_zone="188-192",
            invalidation="Below 178",
            position_sizing="6% of portfolio",
        )
        llm = _structured_setup_llm(captured, proposal)
        setup_planner = create_setup_planner(llm)
        result = setup_planner(_make_setup_state())
        plan = result["trader_investment_plan"]
        assert "**Setup Stance**: Buy" in plan
        assert "**Review Zone**: 188-192" in plan
        assert "FINAL SETUP STANCE: **BUY**" in plan
        # The same rendered markdown is also added to messages for downstream agents.
        assert plan in result["messages"][0].content
        assert result["sender"] == "Setup Planner"

    def test_prompt_includes_investment_plan(self):
        captured = {}
        llm = _structured_setup_llm(captured)
        setup_planner = create_setup_planner(llm)
        setup_planner(_make_setup_state())
        # The investment plan is in the user message of the captured prompt.
        prompt = captured["prompt"]
        assert any("Proposed Research Plan" in m["content"] for m in prompt)
        assert any("Setup Planner" in m["content"] for m in prompt)

    def test_prompt_includes_perp_guidance(self):
        captured = {}
        llm = _structured_setup_llm(captured)
        setup_planner = create_setup_planner(llm)
        setup_planner(_make_setup_state("perp"))
        prompt = captured["prompt"]
        assert any("Market type: perp" in m["content"] for m in prompt)
        assert any("funding" in m["content"] for m in prompt)

    def test_falls_back_to_freetext_when_structured_unavailable(self):
        plain_response = (
            "**Setup Stance**: Sell\n\nGuidance cut hits margins.\n\n"
            "FINAL SETUP STANCE: **SELL**"
        )
        llm = MagicMock()
        llm.with_structured_output.side_effect = NotImplementedError(
            "provider unsupported"
        )
        llm.invoke.return_value = MagicMock(content=plain_response)
        setup_planner = create_setup_planner(llm)
        result = setup_planner(_make_setup_state())
        assert result["trader_investment_plan"] == plain_response

    def test_create_trader_alias_still_works(self):
        captured = {}
        llm = _structured_setup_llm(captured)
        setup_planner = create_trader(llm)
        result = setup_planner(_make_setup_state())
        assert "FINAL SETUP STANCE" in result["trader_investment_plan"]


# ---------------------------------------------------------------------------
# Research Manager agent: structured happy path + fallback
# ---------------------------------------------------------------------------


def _make_rm_state():
    return {
        "company_of_interest": "NVDA",
        "investment_debate_state": {
            "history": "Bull and bear arguments here.",
            "bull_history": "Bull says...",
            "bear_history": "Bear says...",
            "current_response": "",
            "judge_decision": "",
            "count": 1,
        },
    }


def _structured_rm_llm(captured: dict, plan: ResearchPlan | None = None):
    if plan is None:
        plan = ResearchPlan(
            recommendation=PortfolioRating.HOLD,
            rationale="Balanced view across both sides.",
            strategic_actions="Keep on watch; reassess after earnings.",
        )
    structured = MagicMock()
    structured.invoke.side_effect = lambda prompt: (
        captured.__setitem__("prompt", prompt) or plan
    )
    llm = MagicMock()
    llm.with_structured_output.return_value = structured
    return llm


@pytest.mark.unit
class TestResearchManagerAgent:
    def test_structured_path_produces_rendered_markdown(self):
        captured = {}
        plan = ResearchPlan(
            recommendation=PortfolioRating.OVERWEIGHT,
            rationale="Bull case is stronger; AI tailwind intact.",
            strategic_actions="Increase attention gradually over two weeks.",
        )
        llm = _structured_rm_llm(captured, plan)
        rm = create_research_manager(llm)
        result = rm(_make_rm_state())
        ip = result["investment_plan"]
        assert "**Research Stance**: Overweight" in ip
        assert "**Rationale**: Bull case" in ip
        assert "**Review Focus**: Increase attention" in ip

    def test_prompt_uses_5_tier_rating_scale(self):
        """The RM prompt must list all five tiers so the schema enum matches user expectations."""
        captured = {}
        llm = _structured_rm_llm(captured)
        rm = create_research_manager(llm)
        rm(_make_rm_state())
        prompt = captured["prompt"]
        for tier in ("Buy", "Overweight", "Hold", "Underweight", "Sell"):
            assert f"**{tier}**" in prompt, f"missing {tier} in prompt"

    def test_falls_back_to_freetext_when_structured_unavailable(self):
        plain_response = "**Recommendation**: Sell\n\n**Rationale**: ...\n\n**Strategic Actions**: ..."
        llm = MagicMock()
        llm.with_structured_output.side_effect = NotImplementedError(
            "provider unsupported"
        )
        llm.invoke.return_value = MagicMock(content=plain_response)
        rm = create_research_manager(llm)
        result = rm(_make_rm_state())
        assert result["investment_plan"] == plain_response
