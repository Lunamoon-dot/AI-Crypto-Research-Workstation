from tradingagents.domain import ResearchRun, ThesisDirection, TradeThesis
from tradingagents.graph.journal_bridge import JournalBridge


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def test_journal_bridge_saves_scenarios_when_run_completes(tmp_path):
    bridge = JournalBridge(_config(tmp_path))
    run = bridge.start_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
        confidence=0.65,
    )

    run, thesis = bridge.complete_run(run, thesis, signals=[], debate=None)

    scenarios = bridge.service.list_scenarios(thesis_id=thesis.id)
    timeline = bridge.service.list_timeline_events(thesis_id=thesis.id)

    assert run.thesis_id == thesis.id
    assert len(scenarios) == 3
    assert any(event.event_type == "scenarios_saved" for event in timeline)
