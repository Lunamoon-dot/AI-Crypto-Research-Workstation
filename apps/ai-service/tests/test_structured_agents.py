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
    ResearchPlan,
    ScenarioItem,
    ScenarioPlan,
    SetupAction,
    SetupProposal,
    TraderAction,
    TraderProposal,
    render_research_plan,
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
        result = portfolio_manager(_make_pm_state())
        payload = json.loads(result["final_trade_summary_json"])

        assert result["final_trade_decision"] == plain_response
        assert payload["rating"] == "Underweight"
        assert payload["direction"] == "avoid"
        assert payload["market_type"] == "spot"
        assert (
            payload["confirmation_condition"]
            == "Daily close back above 1850 with spot volume."
        )
        assert payload["invalidation"] == "Daily close below 1715."
        assert payload["target_zones"] == ["1650", "1580."]

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
                "setup_type": "agent_debate",
            }
        )

        prompt_text = "\n".join(message["content"] for message in captured["prompt"])
        assert "Analysis date: 2026-05-31" in prompt_text
        assert "Do not attach a specific calendar date" in prompt_text
        assert "prior breakout/support/resistance level" in prompt_text

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

        assert result["scenario_plan"].count("### Scenario") == 4
        plan = ScenarioPlan.model_validate_json(result["scenario_plan_json"])
        assert len(plan.scenarios) == 4
        assert plan.scenarios[-1].scenario_name == "Scenario 4"

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
