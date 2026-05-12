from tradingagents.engine import EngineRunRequest, EngineRunner
from tradingagents.services import JournalService


def test_engine_runner_dry_run_persists_contract_events(tmp_path, monkeypatch):
    db_path = tmp_path / "journal.sqlite"
    monkeypatch.setenv("TRADINGAGENTS_JOURNAL_DB", str(db_path))
    monkeypatch.setenv("TRADINGAGENTS_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TRADINGAGENTS_RESULTS_DIR", str(tmp_path / "logs"))

    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_engine_contract",
            "workspace_id": "workspace_1",
            "symbol": "BTC/USDT",
            "asset_class": "crypto",
            "analysis_date": "2026-05-12",
            "analysts": ["market", "news", "social", "onchain"],
            "config_profile": "default",
            "dry_run": True,
        }
    )

    result = EngineRunner().run(request)
    journal = JournalService(
        {
            "data_cache_dir": str(tmp_path),
            "journal": {"enabled": True, "db_path": str(db_path)},
        }
    )
    run = journal.get_research_run("run_engine_contract")
    events = journal.list_timeline_events(research_run_id="run_engine_contract")

    assert result.model_dump(mode="json") == {
        "run_id": "run_engine_contract",
        "workspace_id": "workspace_1",
        "status": "completed",
        "thesis_id": None,
        "summary": "Dry run validated request and persistence contract.",
        "events_written": 2,
        "error_type": None,
        "error": None,
    }
    assert run is not None
    assert run.workspace_id == "workspace_1"
    assert run.status.value == "completed"
    assert [event.event_type for event in events] == ["run.started", "run.completed"]
