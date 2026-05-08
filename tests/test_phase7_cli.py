import json

from typer.testing import CliRunner

from cli import config_cmd, dashboard, journal_cmd, main
from tradingagents.domain import ResearchRun, TradeThesis
from tradingagents.services import JournalService, WatchlistService


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

    def _precompute_quant_signal(self, ticker, analysis_date):
        return "quant signal"

    def process_signal(self, final_trade_decision):
        return "Hold"

    def _build_trade_plan(self, final_state):
        return None

    def begin_cli_journal_persistence(self, ticker, analysis_date, final_state):
        return None

    def finalize_cli_journal_persistence(self, trade_date, final_state):
        return None


class _FakeProviderStatusError(Exception):
    status_code = 402
    body = {"error": {"message": "Insufficient Balance"}}


class _FakeFailingCompiledGraph:
    def stream(self, init_state, **kwargs):
        raise _FakeProviderStatusError("Insufficient Balance")
        yield


class _FakeFailingResearchGraph(_FakeResearchGraph):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.graph = _FakeFailingCompiledGraph()


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
    monkeypatch.setattr(main, "ResearchAgentsGraph", _FakeResearchGraph)
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


def test_analyze_reports_provider_balance_error_without_traceback(tmp_path, monkeypatch):
    _patch_default_config(monkeypatch, tmp_path)
    monkeypatch.setattr(main, "ResearchAgentsGraph", _FakeFailingResearchGraph)
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

    monkeypatch.setattr(dashboard, "JournalService", lambda _config: journal)
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
    monkeypatch.setattr(
        config_cmd, "resolve_journal_db_path", lambda _cfg: fake_path
    )
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
    result = runner.invoke(
        journal_cmd.journal_app, ["workspace", run.id, "--json"]
    )

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


def test_journal_workspace_text_panel_includes_evidence_section(
    tmp_path, monkeypatch
):
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
