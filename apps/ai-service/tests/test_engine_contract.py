from typing import Any

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
    assert run.market_type == "spot"
    assert run.status.value == "completed"
    assert [event.event_type for event in events] == ["run.started", "run.completed"]
    assert events[0].payload["market_type"] == "spot"


def test_engine_request_accepts_perp_market_type():
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_perp_contract",
            "workspace_id": "workspace_1",
            "symbol": "BTC/USDT",
            "asset_class": "crypto",
            "market_type": "perpetual",
            "analysis_date": "2026-05-12",
            "analysts": ["market"],
            "config_profile": "default",
        }
    )

    assert request.market_type == "perp"


def test_engine_runner_failed_research_persists_failed_status_and_event(tmp_path):
    db_path = tmp_path / "journal.sqlite"
    config = {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {"enabled": True, "db_path": str(db_path)},
        "deep_think_llm": "deep-model",
        "quick_think_llm": "quick-model",
        "llm_provider": "test-provider",
    }
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_engine_failure",
            "workspace_id": "workspace_1",
            "symbol": "ETH/USDT",
            "asset_class": "crypto",
            "market_type": "spot",
            "analysis_date": "2026-05-12",
            "analysts": ["market"],
            "config_profile": "default",
        }
    )

    result = EngineRunner(
        config_loader=_StaticConfigLoader(config),
        research_service_factory=_failing_research_service,
    ).run(request)
    journal = JournalService(config)
    run = journal.get_research_run("run_engine_failure")
    events = journal.list_timeline_events(research_run_id="run_engine_failure")

    assert result.status == "failed"
    assert result.run_id == "run_engine_failure"
    assert result.workspace_id == "workspace_1"
    assert result.error_type == "RuntimeError"
    assert result.error == "provider exploded"
    assert result.events_written == 2
    assert run is not None
    assert run.status.value == "failed"
    assert run.completed_at is not None
    assert [event.event_type for event in events] == ["run.started", "run.failed"]
    failed_payload = events[-1].payload
    assert failed_payload["workspace_id"] == "workspace_1"
    assert failed_payload["market_type"] == "spot"
    assert failed_payload["error_type"] == "RuntimeError"
    assert failed_payload["error"] == "provider exploded"
    assert failed_payload["retryable"] is False
    assert failed_payload["intent"] == "fatal"
    assert failed_payload["engine_contract"] == "v1"


class _StaticConfigLoader:
    def __init__(self, config: dict[str, Any]):
        self.config = config

    def load(self, **_kwargs):
        return dict(self.config)


class _FailingResearchService:
    def run(self, **_kwargs):
        raise RuntimeError("provider exploded")


def _failing_research_service():
    return _FailingResearchService()
