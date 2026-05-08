from typer.testing import CliRunner

from cli import config_cmd, dashboard, main
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
    assert "Research Run Summary" in result.output
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
    assert "TradingAgents Research Workspace" in result.output
    assert "BTC/USDT" in result.output
