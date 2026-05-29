from luna_workstation.agents.schemas import ScenarioItem, ScenarioPlan
from luna_workstation.domain import ResearchRun, ThesisDirection, TradeThesis
from luna_workstation.graph.journal_bridge import (
    JournalBridge,
    _parse_scenario_plan,
    scenarios_from_structured_plan,
)


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def test_journal_bridge_completes_run(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
        confidence=0.65,
    )

    run, thesis = bridge.complete_run(run, thesis)

    assert run is not None
    assert thesis is not None
    assert run.thesis_id == thesis.id


def test_journal_bridge_records_risk_debate_timeline_event(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))

    run, opinions, debate = bridge.save_agent_research(
        run,
        {
            "market_report": "Bullish market structure.",
            "sentiment_report": "",
            "news_report": "",
            "fundamentals_report": "",
            "investment_debate_state": {
                "bull_history": "Bullish because momentum improved.",
                "bear_history": "Bearish risk is funding.",
                "judge_decision": "Watch for confirmation.",
            },
            "trader_investment_plan": "Review long thesis.",
            "risk_debate_state": {
                "aggressive_history": "Upside if reclaim holds.",
                "neutral_history": "Wait for confirmation.",
                "conservative_history": "Protect against downside.",
                "history": "Risk debate history.",
                "judge_decision": "Review thesis only after confirmation.",
            },
            "final_trade_decision": "Hold",
        },
        None,
    )

    assert run is not None
    assert opinions
    assert debate is not None
    timeline = bridge.service.list_timeline_events(research_run_id=run.id)
    assert any(event.event_type == "risk.debate.recorded" for event in timeline)


def test_journal_bridge_saves_scenarios_from_json_plan(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
        confidence=0.65,
    )
    plan = ScenarioPlan(
        setup_type="breakout",
        scenarios=[
            ScenarioItem(
                condition="Break above 108k with volume.",
                expected_behavior="Continuation toward prior highs.",
                probability_band="medium",
                invalidation="Close back below 103k.",
                risk_factors=["Crowded funding"],
                suggested_action="review",
            ),
        ],
    )
    run, thesis = bridge.complete_run(
        run,
        thesis,
        scenario_plan_json=plan.model_dump_json(),
    )
    assert thesis and thesis.id
    scenarios = bridge.service.list_scenarios(thesis_id=thesis.id)
    assert len(scenarios) == 1
    assert scenarios[0].condition.startswith("Break above")


def test_scenarios_from_structured_plan_maps_probability():
    plan = ScenarioPlan(
        setup_type="agent_debate",
        scenarios=[
            ScenarioItem(
                condition="c",
                expected_behavior="b",
                probability_band="HIGH",
                invalidation="i",
                risk_factors=["r"],
                suggested_action="watch",
            ),
        ],
    )
    rows = scenarios_from_structured_plan(plan, "thesis_x")
    assert len(rows) == 1
    assert rows[0].thesis_id == "thesis_x"
    assert rows[0].probability_band.value == "high"


def test_parse_scenario_plan_handles_markdown_headings_without_truncation():
    text = """
Intro text that should not become a scenario.

### Scenario 1: Breakout Catalyst

**Setup Type**: `news_event`

**Key Market Conditions & Catalysts**
- Price breaks above $2,400 with rising volume.
- MACD crosses bullish and ADX rises above 20.
- Social sentiment improves from low attention to moderately positive
  while market breadth confirms that the move is not a single-candle fakeout.

**Probability Assessment**
- **30%** - Catalyst path is possible but not the base case.

**Impact on Investment Thesis**
- HOLD becomes a BUY candidate after confirmation.

**Recommended Response**
- **Review** - Re-run quant and wait for a retest before changing sizing.

---

### Scenario 2: Range Reversion

**Setup Type**: `range_reversion`

**Key Market Conditions & Catalysts**
- Price remains between $2,100 and $2,400 with low volume.
- Support at $2,100 holds after a wick rejection.

**Probability Assessment**
- **45%** - Most likely while volatility stays muted.

**Impact on Investment Thesis**
- HOLD remains unchanged.

**Recommended Response**
- **Watch** - Maintain alerts at both range edges.
"""

    rows = _parse_scenario_plan(text, "thesis_x")

    assert len(rows) == 2
    assert rows[0].thesis_id == "thesis_x"
    assert rows[0].probability_band.value == "low"
    assert rows[1].probability_band.value == "medium"
    assert "Price breaks above $2,400" in rows[0].condition
    assert "ADX rises above 20" in rows[0].condition
    assert rows[0].expected_market_behavior == (
        "HOLD becomes a BUY candidate after confirmation."
    )
    assert rows[0].suggested_user_action.startswith("**Review**")
    assert len(rows[0].condition) > 120
    assert rows[0].expected_market_behavior != rows[0].condition
