from typing import Any

from typer.testing import CliRunner

from cli import main as cli_main
from tradingagents.engine import (
    EngineEvaluateRequest,
    EngineEvaluateResult,
    EngineRunRequest,
    EngineRunResult,
    EngineRunner,
)
from tradingagents.engine.runner import run_evaluate_request
from tradingagents.domain import ResearchRun, ThesisDirection, TradeThesis
from tradingagents.services.evaluation_service import EvaluationService
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
            "exchange": "binance",
            "metadata": {"source": "contract-test"},
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
    assert events[0].payload["exchange"] == "binance"
    assert events[0].payload["metadata"] == {"source": "contract-test"}
    assert events[1].payload["metadata"] == {"source": "contract-test"}


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


def test_engine_request_normalizes_common_crypto_symbols():
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_symbol_normalized",
            "workspace_id": "workspace_1",
            "symbol": " ethdt ",
            "asset_class": "crypto",
            "analysis_date": "2026-05-12",
            "analysts": ["market"],
        }
    )

    assert request.symbol == "ETH/USDT"


def test_engine_request_keeps_only_graph_analyst_lanes():
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_analyst_lanes",
            "workspace_id": "workspace_1",
            "symbol": "ETH/USDT",
            "asset_class": "crypto",
            "analysis_date": "2026-05-12",
            "analysts": ["market", "quant", "risk", "social"],
        }
    )

    assert request.analysts == ["market", "social"]


def test_engine_evaluate_request_accepts_window_presets():
    request = EngineEvaluateRequest.model_validate(
        {
            "thesis_id": "thesis_1",
            "workspace_id": "workspace_1",
            "window_days": 14,
            "metadata": {"source": "test"},
        }
    )

    assert request.window_days == 14
    assert request.metadata == {"source": "test"}


def test_engine_evaluate_binds_dataflow_config_context(tmp_path, monkeypatch):
    db_path = tmp_path / "journal.sqlite"
    config = {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {"enabled": True, "db_path": str(db_path)},
    }
    service = EvaluationService(config=config)
    run = service.repo.save_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = service.repo.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Long if support holds.",
            created_at="2026-01-01T00:00:00+00:00",
            target_zones=["110"],
            invalidation_level="95",
        )
    )

    def fake_route_to_vendor(name, symbol, start_date, end_date):
        from tradingagents.dataflows.config import get_config

        bound = get_config()
        assert name == "get_crypto_ohlcv"
        assert bound["workspace_id"] == "workspace_1"
        assert symbol == "BTC/USDT"
        assert start_date == "2026-01-01"
        assert end_date == "2026-01-15"
        return "\n".join(
            [
                "Date,Open,High,Low,Close,Volume",
                "2026-01-01,100,111,99,108,10",
            ]
        )

    monkeypatch.setattr(
        "tradingagents.engine.runner.DEFAULT_CONFIG",
        config,
    )
    monkeypatch.setattr(
        "tradingagents.services.evaluation_service.route_to_vendor",
        fake_route_to_vendor,
    )

    result = run_evaluate_request(
        EngineEvaluateRequest(
            thesis_id=thesis.id,
            workspace_id="workspace_1",
            window_days=14,
        )
    )

    assert result.status == "completed"
    assert result.error_type is None
    assert result.evaluation is not None
    assert result.evaluation["result"] == "hit_target"


def test_engine_cli_evaluate_emits_machine_json(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    request_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "tradingagents.engine.run_evaluate_request_file",
        lambda _path: EngineEvaluateResult(
            workspace_id="workspace_1",
            thesis_id="thesis_1",
            evaluation_id="evaluation_1",
            status="completed",
            evaluation={"id": "evaluation_1", "result": "hit_target"},
            warnings=[],
        ),
    )

    result = CliRunner().invoke(
        cli_main.app,
        ["engine", "evaluate", "--request", str(request_path)],
    )

    assert result.exit_code == 0
    assert '"status": "completed"' in result.output
    assert '"evaluation_id": "evaluation_1"' in result.output


def test_engine_cli_treats_completed_degraded_as_success(tmp_path, monkeypatch):
    request_path = tmp_path / "request.json"
    request_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "tradingagents.engine.run_engine_request_file",
        lambda _path: EngineRunResult(
            run_id="run_degraded",
            workspace_id="workspace_1",
            status="completed_degraded",
            summary="Completed with optional data gaps.",
        ),
    )

    result = CliRunner().invoke(
        cli_main.app,
        ["engine", "run", "--request", str(request_path)],
    )

    assert result.exit_code == 0
    assert "completed_degraded" in result.output


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
