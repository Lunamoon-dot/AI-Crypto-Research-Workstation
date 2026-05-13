import json

from typer.testing import CliRunner

from cli import (
    config_cmd,
    dashboard,
    journal_cmd,
    main,
    orchestrator,
    research_completion,
    signals_cmd,
    watch_cmd,
)
from tradingagents.domain import (
    DataFreshness,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    SignalDirection,
    SignalProvenance,
    TradeThesis,
)
from tradingagents.services import JournalService, ResearchRunResult, WatchlistService


class _FakePropagator:
    def create_initial_state(self, ticker, analysis_date):
        return {"ticker": ticker, "analysis_date": analysis_date}

    def get_graph_args(self, callbacks=None):
        return {}


class _FakeCompiledGraph:
    def stream(self, init_state, **kwargs):
        yield {
            "market_report": "Market report",
            "sentiment_report": "Sentiment report",
            "news_report": "News report",
            "fundamentals_report": "Onchain report",
            "trader_investment_plan": "Thesis plan",
            "final_trade_decision": "**Rating**: Hold",
        }


class _FakeResearchGraph:
    def __init__(self, *args, **kwargs):
        self.propagator = _FakePropagator()
        self.graph = _FakeCompiledGraph()

    def propagate(
        self,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        final_state = {
            "market_report": "Market report",
            "sentiment_report": "Sentiment report",
            "news_report": "News report",
            "fundamentals_report": "Onchain report",
            "trader_investment_plan": "Thesis plan",
            "final_trade_decision": "**Rating**: Hold",
        }
        if node_callback is not None:
            node_callback(final_state)
        return final_state, self.process_signal(final_state["final_trade_decision"])

    def process_signal(self, final_trade_decision):
        return "Hold"


class _FakeProviderStatusError(Exception):
    status_code = 402
    body = {"error": {"message": "Insufficient Balance"}}


class _FakeFailingResearchGraph(_FakeResearchGraph):
    """Simulate provider rejection before any streamed output."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def propagate(
        self,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        raise _FakeProviderStatusError("Insufficient Balance")


class _FakeResearchService:
    graph_class = _FakeResearchGraph

    def run(
        self,
        *,
        ticker,
        analysis_date,
        selected_analyst_keys,
        config,
        callbacks=None,
        node_callback=None,
        run_callbacks=None,
        debug=True,
    ):
        graph = self.graph_class(
            selected_analyst_keys,
            config=config,
            debug=debug,
            callbacks=callbacks,
        )
        final_state, decision = graph.propagate(
            ticker,
            analysis_date,
            node_callback=node_callback,
            run_callbacks=run_callbacks,
        )
        return ResearchRunResult(final_state, decision, graph)


class _FakeFailingResearchService(_FakeResearchService):
    graph_class = _FakeFailingResearchGraph


def test_orchestrator_supports_legacy_graph_class_injection():
    analysis_orchestrator = orchestrator.AnalysisOrchestrator(_FakeResearchGraph)

    service = analysis_orchestrator._research_service_class()

    assert service._graph_class is _FakeResearchGraph


def _patch_default_config(monkeypatch, tmp_path):
    monkeypatch.setitem(main.DEFAULT_CONFIG, "results_dir", str(tmp_path / "logs"))
    monkeypatch.setitem(main.DEFAULT_CONFIG, "data_cache_dir", str(tmp_path / "cache"))
    monkeypatch.setitem(
        main.DEFAULT_CONFIG,
        "journal",
        {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
    )


def test_analyze_noninteractive_uses_flags_without_prompts(tmp_path, monkeypatch):
    _patch_default_config(monkeypatch, tmp_path)
    monkeypatch.setattr(main, "ResearchService", _FakeResearchService)
    runner = CliRunner()

    result = runner.invoke(
        main.app,
        [
            "analyze",
            "--non-interactive",
            "--ticker",
            "BTC/USDT",
            "--date",
            "2026-05-08",
            "--plain",
        ],
    )

    assert result.exit_code == 0
    assert "Research run complete" in result.output
    assert "BTC/USDT" in result.output
    assert "Save report?" not in result.output


def test_analyze_clear_checkpoints_alone_exits_without_run(tmp_path, monkeypatch):
    """--clear-checkpoints without ticker/non-interactive/plain only clears then exits."""
    _patch_default_config(monkeypatch, tmp_path)
    calls: list[dict] = []

    def capture_run_analysis(**kwargs):
        calls.append(kwargs)
        return {}

    monkeypatch.setattr(main, "run_analysis", capture_run_analysis)
    runner = CliRunner()

    result = runner.invoke(main.app, ["analyze", "--clear-checkpoints"])

    assert result.exit_code == 0
    assert "Cleared" in result.output
    assert calls == []


def test_analyze_clear_checkpoints_with_ticker_still_runs(tmp_path, monkeypatch):
    _patch_default_config(monkeypatch, tmp_path)
    monkeypatch.setattr(main, "ResearchService", _FakeResearchService)
    runner = CliRunner()

    result = runner.invoke(
        main.app,
        [
            "analyze",
            "--clear-checkpoints",
            "--non-interactive",
            "--ticker",
            "BTC/USDT",
            "--date",
            "2026-05-08",
            "--plain",
        ],
    )

    assert result.exit_code == 0
    assert "Cleared" in result.output
    assert "Research run complete" in result.output


def test_analyze_reports_provider_balance_error_without_traceback(
    tmp_path, monkeypatch
):
    _patch_default_config(monkeypatch, tmp_path)
    monkeypatch.setattr(main, "ResearchService", _FakeFailingResearchService)
    runner = CliRunner()

    result = runner.invoke(
        main.app,
        [
            "analyze",
            "--non-interactive",
            "--ticker",
            "BTC/USDT",
            "--date",
            "2026-05-08",
            "--plain",
            "--llm-provider",
            "deepseek",
        ],
    )

    assert result.exit_code == 1
    assert "Provider Error" in result.output
    assert "Deepseek rejected the request" in result.output
    assert "insufficient balance" in result.output.lower()
    assert "Traceback" not in result.output


def test_research_namespace_help_is_available():
    runner = CliRunner()

    result = runner.invoke(main.app, ["research", "--help"])

    assert result.exit_code == 0
    assert "run" in result.output
    assert "workspace" in result.output
    assert "brief" in result.output


def test_analyze_help_mentions_noninteractive_flags():
    command = main.typer.main.get_command(main.app)
    analyze_command = command.commands["analyze"]
    option_names = {
        option
        for param in analyze_command.params
        for option in getattr(param, "opts", [])
    }
    runner = CliRunner()

    result = runner.invoke(main.app, ["analyze", "--help"])

    assert result.exit_code == 0
    assert "--non-interactive" in option_names
    assert "--ticker" in option_names


def test_config_list_uses_correct_show_hint(monkeypatch):
    monkeypatch.setattr(config_cmd, "list_profiles", lambda: ["default"])
    runner = CliRunner()

    result = runner.invoke(config_cmd.config_app, ["list"])

    assert result.exit_code == 0
    assert "tradingagents config show <name>" in result.output


def test_dashboard_renders_terminal_home(tmp_path, monkeypatch):
    config = {
        "data_cache_dir": str(tmp_path),
        "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
    }
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            thesis_text="Watch for confirmation.",
        )
    )
    run.thesis_id = thesis.id
    journal.update_research_run(run)
    watchlists.add_thesis(thesis.id)

    monkeypatch.setattr(dashboard, "ThesisService", lambda _config: journal)
    monkeypatch.setattr(dashboard, "WatchlistService", lambda _config: watchlists)
    runner = CliRunner()

    result = runner.invoke(dashboard.app, [])

    assert result.exit_code == 0
    assert "Research Workspace" in result.output
    assert "BTC/USDT" in result.output


def test_config_setup_renders_first_run_summary_panel(tmp_path, monkeypatch):
    """`config setup` shows a Panel with journal path + disabled-vendor info."""
    fake_path = tmp_path / "journal.sqlite"
    fake_snapshot = {
        "providers": [
            {"vendor": "ccxt", "status": "enabled"},
            {"vendor": "coingecko", "status": "disabled"},
        ],
        "categories": {
            "crypto_ohlcv": {
                "configured": ["ccxt"],
                "enabled": ["ccxt"],
                "disabled": [],
            },
            "crypto_onchain": {
                "configured": ["ccxt", "coingecko"],
                "enabled": ["ccxt"],
                "disabled": ["coingecko"],
            },
        },
        "disabled_data_vendors": ["coingecko"],
        "provider_runtime": {},
    }
    monkeypatch.setattr(config_cmd, "resolve_journal_db_path", lambda _cfg: fake_path)
    monkeypatch.setattr(
        config_cmd, "provider_health_snapshot", lambda _cfg: fake_snapshot
    )
    monkeypatch.setenv("COLUMNS", "240")
    runner = CliRunner()

    result = runner.invoke(config_cmd.config_app, ["setup"])

    assert result.exit_code == 0
    assert "TradingAgents Setup Summary" in result.output
    assert "Journal path:" in result.output
    # The journal path may wrap across lines in narrow terminals; assert the
    # filename is rendered (path is always wide on Windows tmp dirs).
    assert "journal.sqlite" in result.output
    assert "Disabled data vendors: coingecko" in result.output
    assert "Active provider routing:" in result.output
    assert "crypto_onchain: ccxt (disabled: coingecko)" in result.output
    assert "Next Useful Commands" in result.output
    assert "tradingagents research run" in result.output


def test_config_setup_handles_no_disabled_vendors(monkeypatch):
    """`config setup` says 'none' when no vendors are disabled."""
    monkeypatch.setattr(
        config_cmd,
        "provider_health_snapshot",
        lambda _cfg: {
            "providers": [],
            "categories": {},
            "disabled_data_vendors": [],
            "provider_runtime": {},
        },
    )
    runner = CliRunner()

    result = runner.invoke(config_cmd.config_app, ["setup"])

    assert result.exit_code == 0
    assert "Disabled data vendors: none" in result.output


def _patch_journal_default_config(monkeypatch, tmp_path):
    """Redirect journal_cmd's DEFAULT_CONFIG journal db_path to tmp_path."""
    monkeypatch.setitem(
        journal_cmd.DEFAULT_CONFIG,
        "journal",
        {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
    )
    monkeypatch.setitem(
        journal_cmd.DEFAULT_CONFIG, "data_cache_dir", str(tmp_path / "cache")
    )


def test_journal_list_json_emits_empty_array_when_no_runs(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    runner = CliRunner()

    result = runner.invoke(journal_cmd.journal_app, ["list", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output.strip())
    assert payload == []


def test_thesis_list_json_emits_empty_array_when_no_theses(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    runner = CliRunner()

    result = runner.invoke(journal_cmd.thesis_app, ["list", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output.strip())
    assert payload == []


def test_journal_workspace_json_returns_structured_payload(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    config = {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }
    journal = JournalService(config)
    run = journal.start_research_run(ResearchRun(symbol="ETH/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="ETH/USDT",
            thesis_text="Reclaim 4k.",
        )
    )
    run.thesis_id = thesis.id
    journal.update_research_run(run)

    runner = CliRunner()
    result = runner.invoke(journal_cmd.journal_app, ["workspace", run.id, "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output.strip())
    assert set(payload.keys()) >= {
        "run",
        "trade_thesis",
        "scenarios",
        "timeline_events",
        "evidence_notes",
        "next_commands",
    }
    assert payload["run"]["id"] == run.id
    assert payload["run"]["symbol"] == "ETH/USDT"
    assert payload["trade_thesis"]["id"] == thesis.id
    assert any(
        cmd.startswith("tradingagents thesis show ") for cmd in payload["next_commands"]
    )


def test_research_workspace_alias_delegates_to_journal_workspace(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    config = {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }
    journal = JournalService(config)
    run = journal.start_research_run(ResearchRun(symbol="SOL/USDT"))

    runner = CliRunner()
    text_result = runner.invoke(main.app, ["research", "workspace", run.id])
    json_result = runner.invoke(main.app, ["research", "workspace", run.id, "--json"])

    assert text_result.exit_code == 0
    assert "Research Workspace" in text_result.output
    assert "SOL/USDT" in text_result.output
    assert json_result.exit_code == 0
    assert json.loads(json_result.output)["run"]["id"] == run.id


def test_journal_workspace_text_panel_includes_evidence_section(tmp_path, monkeypatch):
    """Default (non-JSON) workspace prints the new evidence panel."""
    _patch_journal_default_config(monkeypatch, tmp_path)
    config = {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }
    journal = JournalService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            thesis_text="Hold above 100k.",
        )
    )
    run.thesis_id = thesis.id
    journal.update_research_run(run)

    runner = CliRunner()
    result = runner.invoke(journal_cmd.journal_app, ["workspace", run.id])

    assert result.exit_code == 0
    assert "Research Workspace" in result.output
    assert "Supporting / Contradicting evidence" in result.output
    assert "Next Useful Commands" in result.output
    assert "tradingagents thesis show" in result.output


def test_journal_show_surfaces_completed_degraded(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    journal = JournalService(
        {
            "data_cache_dir": str(tmp_path / "cache"),
            "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
        }
    )
    run = journal.start_research_run(
        ResearchRun(
            symbol="BTC/USDT",
            status=ResearchRunStatus.COMPLETED_DEGRADED,
            degradation_reasons=["missing_news"],
            missing_optional_data=["missing_news"],
        )
    )
    journal.update_research_run(run)

    runner = CliRunner()
    result = runner.invoke(journal_cmd.journal_app, ["show", run.id])

    assert result.exit_code == 0
    assert "completed (degraded)" in result.output
    assert "Missing Optional Data" in result.output
    assert "missing_news" in result.output


def test_journal_and_thesis_plain_modes_are_line_oriented(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    journal = JournalService(
        {
            "data_cache_dir": str(tmp_path / "cache"),
            "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
        }
    )
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            thesis_text="Plain output test.",
        )
    )
    runner = CliRunner()

    run_result = runner.invoke(journal_cmd.journal_app, ["show", run.id, "--plain"])
    thesis_result = runner.invoke(
        journal_cmd.thesis_app, ["show", thesis.id, "--plain"]
    )

    assert run_result.exit_code == 0
    assert "symbol: BTC/USDT" in run_result.output
    assert "╭" not in run_result.output
    assert thesis_result.exit_code == 0
    assert "thesis_text: Plain output test." in thesis_result.output


def test_json_plain_modes_are_mutually_exclusive(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    runner = CliRunner()

    result = runner.invoke(journal_cmd.journal_app, ["list", "--json", "--plain"])

    assert result.exit_code != 0
    assert "Use only one output mode" in result.output


def test_signals_json_and_plain_modes(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    journal = JournalService(
        {
            "data_cache_dir": str(tmp_path / "cache"),
            "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
        }
    )
    signal = journal.save_signal(
        Signal(
            symbol="BTC/USDT",
            signal_type="momentum",
            direction=SignalDirection.BULLISH,
            confidence=0.8,
            provenance=SignalProvenance(source="test", freshness=DataFreshness.FRESH),
        )
    )
    runner = CliRunner()

    json_result = runner.invoke(signals_cmd.signals_app, ["list", "--json"])
    plain_result = runner.invoke(
        signals_cmd.signals_app, ["show", signal.id, "--plain"]
    )

    assert json_result.exit_code == 0
    assert json.loads(json_result.output)["signals"][0]["symbol"] == "BTC/USDT"
    assert plain_result.exit_code == 0
    assert "symbol: BTC/USDT" in plain_result.output
    assert "╭" not in plain_result.output


def test_watchlist_list_and_brief_json_modes(tmp_path, monkeypatch):
    _patch_journal_default_config(monkeypatch, tmp_path)
    WatchlistService(
        {
            "data_cache_dir": str(tmp_path / "cache"),
            "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
        }
    ).add_symbol("BTC/USDT")
    runner = CliRunner()

    list_result = runner.invoke(watch_cmd.app, ["list", "--json"])
    brief_result = runner.invoke(watch_cmd.app, ["brief", "--json"])

    assert list_result.exit_code == 0
    assert json.loads(list_result.output)["items"][0]["symbol"] == "BTC/USDT"
    assert brief_result.exit_code == 0
    assert json.loads(brief_result.output)["brief"]["item_count"] == 1


def test_research_run_yes_profile_is_noninteractive(monkeypatch, tmp_path):
    captured = {}

    def fake_run_analysis(**kwargs):
        captured.update(kwargs)
        return {}

    monkeypatch.setattr(main, "run_analysis", fake_run_analysis)
    monkeypatch.setattr(
        main.typer,
        "prompt",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("prompted")),
    )
    runner = CliRunner()

    result = runner.invoke(
        main.app,
        [
            "research",
            "run",
            "BTC/USDT",
            "--date",
            "2026-05-08",
            "--profile",
            "default",
            "--yes",
            "--plain",
        ],
    )

    assert result.exit_code == 0
    assert captured["non_interactive"] is True
    assert captured["plain"] is True
    assert captured["selections"]["profile"] == "default"
    assert captured["selections"]["ticker"] == "BTC/USDT"


def test_research_completion_panel_prioritizes_readable_summary():
    class FakeService:
        def get_signal_snapshot(self, _snapshot_id):
            return None

        def get_thesis(self, thesis_id):
            return TradeThesis(
                id=thesis_id,
                symbol="SOL/USDT",
                direction="short",
                confidence=0.24,
                entry_zone="Break above $100 on daily volume",
                invalidation_level="Close below $90",
                target_zones=["Trim 25-50% at market"],
                thesis_text="**Bottom Line:** Reduce risk and keep a smaller core.",
            )

    class FakeBridge:
        service = FakeService()

    class FakeGraph:
        journal_bridge = FakeBridge()
        current_debate = None
        current_research_run = ResearchRun(
            id="run_abc",
            symbol="SOL/USDT",
            thesis_id="thesis_abc",
            signal_snapshot_id="signal_abc",
        )

    console = research_completion.Console(record=True, width=180)

    research_completion.emit_research_run_complete_panel(
        console,
        graph=FakeGraph(),
        selections={"ticker": "SOL/USDT", "analysis_date": "2026-05-12"},
        rating="Underweight",
        config={"journal": {"enabled": True}},
    )

    output = console.export_text()
    assert "Readable Summary" in output
    assert "PM rating: Underweight" in output
    assert "Thesis direction: short" in output
    assert "Invalidation: Close below $90" in output
    assert "Record IDs: run=run_abc, thesis=thesis_abc, signals=signal_abc" in output
    assert "tradingagents research evaluate matured" in output
    assert "tradingagents evaluate matured" not in output
    assert "Market Snapshot:" not in output
