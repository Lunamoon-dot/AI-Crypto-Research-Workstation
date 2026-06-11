"""Tests for structured-output agents (Setup Planner and Research Manager).

The Portfolio Manager has its own coverage in tests/test_memory_log.py
(which exercises the full memory-log → PM injection cycle).  This file
covers the parallel schemas, render functions, and graceful-fallback
behavior we added for the Setup Planner and Research Manager so all three
decision-making agents share the same shape.
"""

from unittest.mock import MagicMock
import json

import pytest

from luna_workstation.agents.managers.portfolio_manager import (
    create_portfolio_manager,
)
from luna_workstation.agents.managers.research_manager import create_research_manager
from luna_workstation.agents.schemas import (
    MarketType,
    PortfolioRating,
    PortfolioDecision,
    ResearchPlan,
    ScenarioHorizon,
    ScenarioItem,
    ScenarioPlan,
    SetupAction,
    SetupProposal,
    TraderAction,
    TraderProposal,
    render_research_plan,
    render_scenario_plan,
    render_setup_proposal,
    render_trader_proposal,
)
from luna_workstation.agents.planners.setup_planner import (
    create_setup_planner,
    create_trader,
)
from luna_workstation.agents.planners.scenario_planner import create_scenario_planner


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
            confirmation_condition="Daily close above 196 with spot volume expansion",
            invalidation="Daily close below 178",
            target_zones=["205", "220"],
            position_sizing="6% of portfolio",
            spot_notes="Use staged accumulation; no leverage.",
        )
        md = render_setup_proposal(p)
        assert "**Setup Stance**: Buy" in md
        assert "**Review Zone**: 188-192" in md
        assert (
            "**Confirmation**: Daily close above 196 with spot volume expansion" in md
        )
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
# Portfolio Manager agent: structured fallback repair
# ---------------------------------------------------------------------------


def _make_pm_state():
    return {
        "company_of_interest": "ETH/USDT",
        "market_type": "spot",
        "quant_signal": "=== Quant Bias: ETH/USDT ===\nPrice: $1,647.71",
        "investment_plan": "**Research Stance**: Underweight\nAvoid fresh longs.",
        "trader_investment_plan": (
            "**Setup Stance**: Underweight\n"
            "**Confirmation**: Daily close back above 1850 with spot volume.\n"
            "**Invalidation**: Daily close below 1715.\n"
            "**Objective Zones**: 1650; 1580."
        ),
        "risk_debate_state": {
            "history": "Conservative and neutral analysts prefer avoiding new longs.",
            "aggressive_history": "",
            "conservative_history": "",
            "neutral_history": "",
            "current_aggressive_response": "",
            "current_conservative_response": "",
            "current_neutral_response": "",
            "count": 1,
        },
    }


@pytest.mark.unit
class TestPortfolioManagerAgent:
    def test_free_text_fallback_synthesizes_summary_json(self):
        plain_response = "\n".join(
            [
                "**Portfolio Manager's Final Research Thesis: ETH/USDT (Spot)**",
                "**Stance**: Underweight - avoid new longs.",
                "**Research Summary**: Avoid long until reclaim confirmation.",
                "**Investment Thesis**: Trend and risk evidence favor patience.",
                "**Confirmation**: Daily close back above 1850 with spot volume.",
                "**Invalidation**: Daily close below 1715.",
                "**Target Zones**: 1650; 1580.",
                "**Missing Data**: liquidation heatmap.",
            ]
        )
        llm = MagicMock()
        llm.with_structured_output.side_effect = NotImplementedError(
            "provider unsupported"
        )
        llm.invoke.return_value = MagicMock(content=plain_response)

        portfolio_manager = create_portfolio_manager(llm, config={})
        state = _make_pm_state()
        state["latest_continuity_context"] = {
            "summary": "Prior continuity exists.",
            "active_invalidations": ["Invalidate below 65000 on volume."],
        }
        result = portfolio_manager(state)
        payload = json.loads(result["final_trade_summary_json"])

        assert result["final_trade_decision"] == plain_response
        assert result["scenario_continuity_handoff"] is None
        assert "Current price anchor: $1,647.71" in llm.invoke.call_args.args[0]
        assert payload["rating"] == "Underweight"
        assert payload["direction"] == "avoid"
        assert payload["market_type"] == "spot"
        assert payload["investment_thesis"] == (
            "Trend and risk evidence favor patience."
        )
        assert (
            payload["confirmation_condition"]
            == "Daily close back above 1850 with spot volume."
        )
        assert payload["invalidation"] == "Daily close below 1715."
        assert payload["target_zones"] == ["1650", "1580."]

    def test_free_text_fallback_validates_trade_thesis_json_block(self):
        thesis_json = {
            "schema_version": "thesis_candidate.v1",
            "rating": "Underweight",
            "direction": "avoid",
            "confidence": 0.55,
            "market_type": "spot",
            "action_summary": "Avoid fresh longs until reclaim confirmation.",
            "investment_thesis": "Trend and risk evidence favor patience.",
            "confirmation_condition": "Daily close back above 1850 with spot volume.",
            "invalidation": "Daily close below 1715.",
            "entry_zone": "1780-1820 failed retest",
            "target_zones": ["1650", "1580"],
            "key_reasons": ["Risk debate favors defensive exposure."],
            "risks": ["Liquidity data is incomplete."],
            "monitor_next": ["Watch daily close and spot volume."],
            "supporting_evidence": [],
            "missing_data": ["liquidation heatmap"],
        }
        plain_response = (
            "**Portfolio Manager's Final Research Thesis: ETH/USDT (Spot)**\n"
            "Raw prose should not become the contract.\n\n"
            "TRADE_THESIS_JSON:\n"
            "```json\n"
            f"{json.dumps(thesis_json)}\n"
            "```"
        )
        llm = MagicMock()
        llm.with_structured_output.side_effect = NotImplementedError(
            "provider unsupported"
        )
        llm.invoke.return_value = MagicMock(content=plain_response)

        portfolio_manager = create_portfolio_manager(llm, config={})
        result = portfolio_manager(_make_pm_state())
        payload = json.loads(result["final_trade_summary_json"])

        assert result["final_trade_candidate_source"] == "portfolio_decision_json_block"
        assert "Raw prose should not become the contract." in result["final_trade_decision"]
        assert "TRADE_THESIS_JSON" not in result["final_trade_decision"]
        assert payload["rating"] == thesis_json["rating"]
        assert payload["direction"] == thesis_json["direction"]
        assert payload["entry_zone"] == thesis_json["entry_zone"]
        assert payload["target_zones"] == thesis_json["target_zones"]
        assert payload["spot_notes"] == ""
        assert payload["perp_notes"] == ""

    def test_llm_failure_falls_back_to_prior_artifacts(self):
        structured = MagicMock()
        structured.invoke.side_effect = TimeoutError("provider timed out")
        llm = MagicMock()
        llm.with_structured_output.return_value = structured
        llm.invoke.side_effect = TimeoutError("provider timed out")

        portfolio_manager = create_portfolio_manager(llm, config={})
        result = portfolio_manager(_make_pm_state())
        payload = json.loads(result["final_trade_summary_json"])

        assert "**Rating**: Underweight" in result["final_trade_decision"]
        assert "deterministic fallback" in result["final_trade_decision"]
        assert payload["rating"] == "Underweight"
        assert payload["direction"] == "avoid"
        assert (
            payload["confirmation_condition"]
            == "Daily close back above 1850 with spot volume."
        )
        assert payload["invalidation"] == "Daily close below 1715."

    def test_prompt_includes_current_price_context(self):
        captured = {}
        structured = MagicMock()
        structured.invoke.side_effect = lambda prompt: (
            captured.__setitem__("prompt", prompt)
            or PortfolioDecision(
                rating=PortfolioRating.UNDERWEIGHT,
                executive_summary="Avoid fresh longs.",
                investment_thesis="Live-price anchored thesis.",
                confidence=0.2,
                market_type=MarketType.SPOT,
                action_summary="Avoid fresh longs.",
                confirmation_condition="Watch for live-price anchored confirmation.",
                invalidation="Live-price anchored invalidation.",
                entry_zone="No new long entry below reclaim.",
                target_zones=["1850 reclaim review"],
                key_reasons=[],
                risks=[],
                monitor_next=[],
                supporting_evidence=[],
                spot_notes="",
                perp_notes="",
                missing_data=[],
            )
        )
        llm = MagicMock()
        llm.with_structured_output.return_value = structured

        portfolio_manager = create_portfolio_manager(llm, config={})
        result = portfolio_manager(_make_pm_state())
        payload = json.loads(result["final_trade_summary_json"])

        assert "$1,647.71" in captured["prompt"]
        assert "Do not assume price levels" in captured["prompt"]
        assert '"investment_thesis"' in captured["prompt"]
        assert payload["investment_thesis"] == "Live-price anchored thesis."
        assert payload["entry_zone"] == "No new long entry below reclaim."
        assert payload["target_zones"] == ["1850 reclaim review"]

    def test_extracts_only_pm_authored_scenario_continuity_handoff(self):
        handoff = {
            "continuity_relation": "weakens",
            "summary": "Prior long thesis is weakening.",
            "short_term_focus": "Watch reclaim failure.",
            "mid_term_focus": "Compare catalyst follow-through.",
            "long_term_focus": "Track structural invalidation.",
            "carry_forward_watchpoints": ["Prior reclaim zone"],
            "carry_forward_invalidations": ["Prior invalidation level"],
            "stale_prior": False,
        }
        structured = MagicMock()
        structured.invoke.return_value = PortfolioDecision(
            rating=PortfolioRating.HOLD,
            executive_summary="Hold pending confirmation.",
            investment_thesis="Current evidence is mixed.",
            confidence=0.5,
            market_type=MarketType.SPOT,
            action_summary="Watch.",
            confirmation_condition="Reclaim resistance.",
            invalidation="Lose support.",
            key_reasons=[],
            risks=[],
            monitor_next=[],
            supporting_evidence=[],
            spot_notes="",
            perp_notes="",
            missing_data=[],
            scenario_continuity_handoff=handoff,
        )
        llm = MagicMock()
        llm.with_structured_output.return_value = structured

        portfolio_manager = create_portfolio_manager(llm, config={})
        result = portfolio_manager(_make_pm_state())

        assert result["scenario_continuity_handoff"] == handoff


# ---------------------------------------------------------------------------
# Setup Planner agent: structured happy path + fallback
# ---------------------------------------------------------------------------


def _make_setup_state(market_type: str = "spot"):
    return {
        "company_of_interest": "NVDA",
        "market_type": market_type,
        "quant_signal": "=== Quant Bias: NVDA ===\nPrice: $682.00",
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
            confirmation_condition="Daily close above 196",
            invalidation="Below 178",
            position_sizing="6% of portfolio",
        )
        llm = _structured_setup_llm(captured, proposal)
        setup_planner = create_setup_planner(llm)
        result = setup_planner(_make_setup_state())
        plan = result["trader_investment_plan"]
        assert "**Setup Stance**: Buy" in plan
        assert "**Review Zone**: 188-192" in plan
        assert "**Confirmation**: Daily close above 196" in plan
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
        assert any("Current price anchor: $682.00" in m["content"] for m in prompt)

    def test_prompt_includes_perp_guidance(self):
        captured = {}
        llm = _structured_setup_llm(captured)
        setup_planner = create_setup_planner(llm)
        setup_planner(_make_setup_state("perp"))
        prompt = captured["prompt"]
        assert any("Market type: perp" in m["content"] for m in prompt)
        assert any("funding" in m["content"] for m in prompt)

    def test_prompt_includes_current_price_context(self):
        captured = {}
        llm = _structured_setup_llm(captured)
        setup_planner = create_setup_planner(llm)
        setup_planner(_make_setup_state())
        prompt = captured["prompt"]
        user_text = "\n".join(m["content"] for m in prompt)
        assert "$682" in user_text
        assert "Do not assume price levels" in user_text

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

    def test_llm_failure_falls_back_to_debate_artifacts(self):
        structured = MagicMock()
        structured.invoke.side_effect = TimeoutError("provider timed out")
        llm = MagicMock()
        llm.with_structured_output.return_value = structured
        llm.invoke.side_effect = TimeoutError("provider timed out")

        rm = create_research_manager(llm)
        result = rm(_make_rm_state())

        assert "**Research Manager deterministic fallback: NVDA**" in result["investment_plan"]
        assert "**Research Stance**: Hold" in result["investment_plan"]
        assert "Bull and bear arguments here." in result["investment_plan"]
        assert result["investment_debate_state"]["current_response"] == result["investment_plan"]


# ---------------------------------------------------------------------------
# Scenario Planner agent: prompt grounding
# ---------------------------------------------------------------------------


def _structured_scenario_llm(captured: dict, plan: ScenarioPlan | None = None):
    if plan is None:
        plan = ScenarioPlan(
            setup_type="agent_debate",
            scenarios=[
                ScenarioItem(
                    scenario_name="Watch Zone Reclaim",
                    direction="neutral",
                    thesis_impact="medium",
                    condition="If price reclaims the review zone with fresh volume.",
                    expected_behavior="Momentum improves after confirmation.",
                    evidence=["Price: review zone", "Volume: fresh"],
                    watch_triggers=["Price reclaims the review zone", "Volume expands"],
                    impact_on_thesis="Challenges wait mode only after confirmation.",
                    probability_band="medium",
                    invalidation="Invalid if price loses the review zone.",
                    risk_factors=["Manual review required."],
                    suggested_action="watch",
                    as_of="2026-05-31",
                    timeframe="1D",
                    source=["market_report"],
                )
            ],
        )
    structured = MagicMock()

    def invoke(prompt):
        captured["prompt"] = prompt
        return plan

    structured.invoke.side_effect = invoke
    llm = MagicMock()
    llm.with_structured_output.return_value = structured
    return llm


@pytest.mark.unit
class TestScenarioPlannerAgent:
    def test_scenario_plan_renders_horizon_identity(self):
        plan = ScenarioPlan(
            setup_type="agent_debate",
            scenarios=[
                ScenarioItem(
                    horizon=ScenarioHorizon.SHORT_TERM,
                    timeframe_label="24-72h",
                    scenario_name="Short-term reclaim",
                    direction="bullish risk",
                    thesis_impact="medium",
                    condition="If price reclaims resistance with volume.",
                    expected_behavior="Fast tactical reaction toward prior highs.",
                    evidence=["Volume: improving"],
                    watch_triggers=["Reclaim resistance"],
                    impact_on_thesis="Supports the thesis tactically.",
                    probability_band="medium",
                    invalidation="Invalid if price loses the reclaim.",
                    risk_factors=["False breakout risk"],
                    suggested_action="watch",
                    as_of="2026-06-10",
                    timeframe="1D",
                    source=["market_report"],
                )
            ],
        )

        markdown = render_scenario_plan(plan)

        assert "**Horizon**: short_term" in markdown
        assert "**Horizon Window**: 24-72h" in markdown

    def test_structured_output_normalizes_exactly_three_horizons(self):
        captured = {}
        llm = _structured_scenario_llm(
            captured,
            ScenarioPlan(
                setup_type="agent_debate",
                scenarios=[
                    ScenarioItem(
                        horizon=ScenarioHorizon.SHORT_TERM,
                        timeframe_label="24-72h",
                        scenario_name="Short tactical reclaim",
                        direction="bullish risk",
                        thesis_impact="medium",
                        condition="If price reclaims resistance with volume.",
                        expected_behavior="Fast tactical reaction.",
                        evidence=["Volume: improving"],
                        watch_triggers=["Reclaim resistance"],
                        impact_on_thesis="Supports the thesis tactically.",
                        probability_band="medium",
                        invalidation="Invalid if price loses the reclaim.",
                        risk_factors=["False breakout risk"],
                        suggested_action="watch",
                        as_of="2026-06-10",
                        timeframe="1D",
                        source=["market_report"],
                    ),
                    ScenarioItem(
                        horizon=ScenarioHorizon.SHORT_TERM,
                        timeframe_label="24-72h",
                        scenario_name="Duplicate short branch",
                        direction="neutral",
                        thesis_impact="low",
                        condition="If price chops near resistance.",
                        expected_behavior="Sideways tactical churn.",
                        evidence=["Range: tight"],
                        watch_triggers=["Range holds"],
                        impact_on_thesis="Keeps thesis on watch.",
                        probability_band="low",
                        invalidation="Invalid if price breaks range.",
                        risk_factors=["Low signal quality"],
                        suggested_action="watch",
                        as_of="2026-06-10",
                        timeframe="1D",
                        source=["market_report"],
                    ),
                ],
            ),
        )
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "BTC/USDT",
                "trade_date": "2026-06-10",
                "investment_plan": "Overweight if reclaim confirms.",
                "final_trade_decision": "Watch reclaim and invalidation.",
                "market_report": "Price is below resistance.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        assert [scenario.horizon for scenario in plan.scenarios] == [
            ScenarioHorizon.SHORT_TERM,
            ScenarioHorizon.MID_TERM,
            ScenarioHorizon.LONG_TERM,
        ]
        assert len(plan.scenarios) == 3

    def test_structured_output_replaces_duplicate_horizon_content_with_fallback(self):
        duplicate_condition = "If price reclaims resistance with volume."
        duplicate_behavior = "Momentum improves after confirmation."

        def plan_for(horizon: ScenarioHorizon) -> ScenarioPlan:
            return ScenarioPlan(
                setup_type="agent_debate",
                scenarios=[
                    ScenarioItem(
                        horizon=horizon,
                        timeframe_label="",
                        scenario_name=f"{horizon.value} duplicate",
                        direction="bullish risk",
                        thesis_impact="medium",
                        condition=duplicate_condition,
                        expected_behavior=duplicate_behavior,
                        evidence=["Volume: improving"],
                        watch_triggers=["Reclaim resistance"],
                        impact_on_thesis="Supports the thesis.",
                        probability_band="medium",
                        invalidation="Invalid if price loses the reclaim.",
                        risk_factors=["False breakout risk"],
                        suggested_action="watch",
                        as_of="2026-06-10",
                        timeframe="1D",
                        source=["market_report"],
                    )
                ],
            )

        structured = MagicMock()
        structured.invoke.side_effect = [
            plan_for(ScenarioHorizon.SHORT_TERM),
            plan_for(ScenarioHorizon.MID_TERM),
            plan_for(ScenarioHorizon.LONG_TERM),
        ]
        llm = MagicMock()
        llm.with_structured_output.return_value = structured
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "BTC/USDT",
                "trade_date": "2026-06-10",
                "investment_plan": "Overweight if reclaim confirms.",
                "final_trade_decision": "Watch reclaim and invalidation.",
                "market_report": "Price is below resistance.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        assert plan.scenarios[0].condition == duplicate_condition
        assert plan.scenarios[1].scenario_name == "Mid-term thesis follow-through"
        assert plan.scenarios[2].scenario_name == "Long-term structural branch"
        assert len({scenario.condition for scenario in plan.scenarios}) == 3

    def test_structured_output_uses_fallback_for_one_failed_horizon(self):
        short_plan = ScenarioPlan(
            setup_type="agent_debate",
            scenarios=[
                ScenarioItem(
                    horizon=ScenarioHorizon.SHORT_TERM,
                    timeframe_label="24-72h",
                    scenario_name="Short tactical reclaim",
                    direction="bullish risk",
                    thesis_impact="medium",
                    condition="If price reclaims resistance with volume.",
                    expected_behavior="Fast tactical reaction.",
                    evidence=["Volume: improving"],
                    watch_triggers=["Reclaim resistance"],
                    impact_on_thesis="Supports the thesis tactically.",
                    probability_band="medium",
                    invalidation="Invalid if price loses the reclaim.",
                    risk_factors=["False breakout risk"],
                    suggested_action="watch",
                    as_of="2026-06-10",
                    timeframe="1D",
                    source=["market_report"],
                ),
            ],
        )
        long_plan = short_plan.model_copy(
            update={
                "scenarios": [
                    short_plan.scenarios[0].model_copy(
                        update={
                            "horizon": ScenarioHorizon.LONG_TERM,
                            "timeframe_label": "1-3m",
                            "scenario_name": "Long structural durability",
                        }
                    )
                ]
            }
        )
        structured = MagicMock()
        structured.invoke.side_effect = [short_plan, TimeoutError("mid failed"), long_plan]
        llm = MagicMock()
        llm.with_structured_output.return_value = structured
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "BTC/USDT",
                "trade_date": "2026-06-10",
                "investment_plan": "Overweight if reclaim confirms.",
                "final_trade_decision": "Watch reclaim and invalidation.",
                "market_report": "Price is below resistance.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        assert [scenario.horizon for scenario in plan.scenarios] == [
            ScenarioHorizon.SHORT_TERM,
            ScenarioHorizon.MID_TERM,
            ScenarioHorizon.LONG_TERM,
        ]
        assert plan.scenarios[1].scenario_name == "Mid-term thesis follow-through"
        assert result["scenario_plan"].count("### Scenario") == 3

    def test_prompt_includes_analysis_date_and_date_provenance_guard(self):
        captured = {}
        llm = _structured_scenario_llm(captured)
        scenario_planner = create_scenario_planner(llm)

        scenario_planner(
            {
                "company_of_interest": "BNB/USDT",
                "trade_date": "2026-05-31",
                "investment_plan": "RSI divergence near a pullback zone.",
                "final_trade_decision": "Watch the $643 level for confirmation.",
                "market_report": "Price is near $643. No dated breakout evidence.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "quant_signal": "Price: $1,647.71\nTrend: bearish",
                "setup_type": "agent_debate",
            }
        )

        prompt_text = "\n".join(message["content"] for message in captured["prompt"])
        assert "Analysis date: 2026-05-31" in prompt_text
        assert "Do not attach a specific calendar date" in prompt_text
        assert "prior breakout/support/resistance level" in prompt_text
        assert "Current price anchor: $1,647.71" in prompt_text

    def test_prompt_honors_output_language_config(self):
        captured = {}
        llm = _structured_scenario_llm(captured)
        scenario_planner = create_scenario_planner(
            llm, config={"output_language": "Vietnamese"}
        )

        scenario_planner(
            {
                "company_of_interest": "BTC/USDT",
                "trade_date": "2026-06-04",
                "investment_plan": "Wait for a confirmed reclaim.",
                "final_trade_decision": "Watch the reclaim trigger.",
                "market_report": "Price is below resistance.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        prompt_text = "\n".join(message["content"] for message in captured["prompt"])
        assert "Write your entire response in Vietnamese" in prompt_text

    def test_structured_output_replaces_unsupported_calendar_dates(self):
        captured = {}
        llm = _structured_scenario_llm(
            captured,
            ScenarioPlan(
                setup_type="agent_debate",
                scenarios=[
                    ScenarioItem(
                        scenario_name="Unsupported Date Retest",
                        direction="neutral",
                        thesis_impact="medium",
                        condition="If price retests the May 30 breakout level ($643).",
                        expected_behavior="May 30 support should hold before upside.",
                        evidence=["May 30 level: not sourced."],
                        watch_triggers=["Retest the May 30 breakout level"],
                        impact_on_thesis="May 30 reference should be grounded before upgrading.",
                        probability_band="medium",
                        invalidation="Invalid below the May 30 low.",
                        risk_factors=["May 30 level was not sourced."],
                        suggested_action="watch",
                        as_of="May 30",
                        timeframe="1D",
                        source=["market_report"],
                    )
                ],
            ),
        )
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "BNB/USDT",
                "trade_date": "2026-05-31",
                "investment_plan": "RSI divergence near a pullback zone.",
                "final_trade_decision": "Watch the $643 level for confirmation.",
                "market_report": "Price is near $643. No dated breakout evidence.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        assert "May 30" not in result["scenario_plan"]
        assert "May 30" not in result["scenario_plan_json"]
        assert "prior breakout level ($643)" in result["scenario_plan"]

    def test_structured_output_limits_scenario_count(self):
        captured = {}
        llm = _structured_scenario_llm(
            captured,
            ScenarioPlan(
                setup_type="agent_debate",
                scenarios=[
                    ScenarioItem(
                        scenario_name=f"Scenario {index}",
                        direction="neutral",
                        thesis_impact="low",
                        condition=f"Condition {index}",
                        expected_behavior=f"Behavior {index}",
                        evidence=[f"Evidence {index}"],
                        watch_triggers=[f"Watch {index}"],
                        impact_on_thesis=f"Impact {index}",
                        probability_band="medium",
                        invalidation=f"Invalidation {index}",
                        risk_factors=[f"Risk {index}"],
                        suggested_action="watch",
                        as_of="2026-05-31",
                        timeframe="1D",
                        source=["market_report"],
                    )
                    for index in range(1, 7)
                ],
            ),
        )
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "BNB/USDT",
                "trade_date": "2026-05-31",
                "investment_plan": "Wait for confirmation.",
                "final_trade_decision": "Watch the trigger.",
                "market_report": "Price is below resistance.",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        assert result["scenario_plan"].count("### Scenario") == 3
        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        assert len(plan.scenarios) == 3
        assert [scenario.horizon for scenario in plan.scenarios] == [
            ScenarioHorizon.SHORT_TERM,
            ScenarioHorizon.MID_TERM,
            ScenarioHorizon.LONG_TERM,
        ]

    def test_structured_output_enriches_missing_provenance_fields(self):
        captured = {}
        llm = _structured_scenario_llm(
            captured,
            ScenarioPlan(
                setup_type="agent_debate",
                scenarios=[
                    ScenarioItem(
                        scenario_name="Dead Cat Bounce",
                        direction="bearish risk",
                        thesis_impact="low",
                        condition="If ETH bounces weakly into resistance.",
                        expected_behavior="Trend remains fragile after the bounce.",
                        evidence=["RSI oversold on the daily chart."],
                        watch_triggers=["Price reclaims 1680 intraday"],
                        impact_on_thesis="Still supports underweight unless follow-through improves.",
                        probability_band="medium",
                        invalidation="Invalid if ETH closes above 1720 with volume.",
                        risk_factors=["Thin weekend liquidity."],
                        suggested_action="review",
                        as_of="",
                        timeframe="",
                        source=[],
                    )
                ],
            ),
        )
        scenario_planner = create_scenario_planner(llm)

        result = scenario_planner(
            {
                "company_of_interest": "ETH/USDT",
                "trade_date": "2026-06-08",
                "investment_plan": "Underweight until market structure improves.",
                "final_trade_decision": "Review the resistance zone before upgrading.",
                "market_report": (
                    "Market report for ETH/USDT. Analysis date: 2026-06-08. "
                    "Primary timeframe: 1D. Daily trend remains bearish."
                ),
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "setup_type": "agent_debate",
            }
        )

        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        scenario = plan.scenarios[0]
        assert scenario.as_of == "2026-06-08"
        assert scenario.timeframe == "1D"
        assert scenario.source == ["market_report"]
