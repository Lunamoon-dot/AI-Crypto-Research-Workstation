from tradingagents.agents.schemas import ScenarioItem, ScenarioPlan
from tradingagents.domain import ResearchRun, ThesisDirection, TradeThesis
from tradingagents.graph.journal_bridge import JournalBridge, scenarios_from_structured_plan


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
