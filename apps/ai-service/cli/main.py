"""LunaCrypto CLI - entry point and command registration.

After the God-file split, this module is a thin shell that:
- Registers all sub-commands
- Defines the top-level ``analyze`` and ``research run`` commands
- Delegates orchestration to ``AnalysisOrchestrator``
"""

from __future__ import annotations

import datetime
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from typer import Context

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services import ResearchService

# -- Post-split imports --------------------------------------------------
from cli.orchestrator import run_analysis as _run_analysis
from cli.selections import selections_from_cli_options


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(errors="replace")


_configure_stdio()

console = Console()

app = typer.Typer(
    name="LunaCrypto",
    help="LunaCrypto CLI: AI crypto research workspace",
    add_completion=True,
)

# Register sub-commands
from cli.watch_cmd import app as watchlist_app
from cli.watch_cmd import register_watch
from cli.dashboard import register_dashboard
from cli.config_cmd import register_config
from cli.brief_cmd import app as brief_app
from cli.brief_cmd import daily as market_brief_daily
from cli.brief_cmd import register_brief
from cli.journal_cmd import (
    journal_app,
    journal_workspace,
    register_journal,
    thesis_app,
)
from cli.signals_cmd import register_signals, signals_app
from cli.evaluate_cmd import evaluate_app
from cli.replay_cmd import replay_app
from cli.diff_cmd import diff_app, register_diff

register_watch(app)
register_dashboard(app)
register_config(app)
register_journal(app)
register_signals(app)
register_brief(app)
register_diff(app)


# ---------------------------------------------------------------------------
# Top-level commands
# ---------------------------------------------------------------------------


@app.command()
def analyze(
    checkpoint: bool = typer.Option(
        False,
        "--checkpoint",
        help="Enable checkpoint/resume: save state after each node so a crashed run can resume.",
    ),
    clear_checkpoints: bool = typer.Option(
        False,
        "--clear-checkpoints",
        help=(
            "Delete all saved checkpoints before running (force fresh start). "
            "If this is the only run-related flag, exit after clearing (no wizard)."
        ),
    ),
    ticker: Optional[str] = typer.Option(
        None,
        "--ticker",
        "-t",
        help="Ticker for non-interactive research, e.g. BTC/USDT.",
    ),
    analysis_date: Optional[str] = typer.Option(
        None,
        "--date",
        help="Analysis date for non-interactive research (YYYY-MM-DD).",
    ),
    asset_class: str = typer.Option(
        "crypto",
        "--asset-class",
        help="Asset class for non-interactive research: crypto or stock.",
    ),
    market_type: str = typer.Option(
        "spot",
        "--market-type",
        help="Research market type for crypto setups: spot or perp.",
    ),
    exchange: Optional[str] = typer.Option(
        None,
        "--exchange",
        help="Crypto exchange id for market data, e.g. binance.",
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts: market,social,news,onchain.",
    ),
    research_depth: int = typer.Option(
        1,
        "--research-depth",
        min=1,
        help="Debate depth/round count for non-interactive research.",
    ),
    llm_provider: Optional[str] = typer.Option(
        None,
        "--llm-provider",
        help="LLM provider key. Defaults to config.",
    ),
    profile: Optional[str] = typer.Option(
        None,
        "--profile",
        "-p",
        help="Configuration profile to load.",
    ),
    backend_url: Optional[str] = typer.Option(
        None,
        "--backend-url",
        help="Optional provider-compatible backend URL.",
    ),
    quick_model: Optional[str] = typer.Option(
        None,
        "--quick-model",
        help="Quick-thinking model id. Defaults to config.",
    ),
    deep_model: Optional[str] = typer.Option(
        None,
        "--deep-model",
        help="Deep-thinking model id. Defaults to config.",
    ),
    output_language: str = typer.Option(
        "English",
        "--output-language",
        help="Language for generated reports.",
    ),
    non_interactive: bool = typer.Option(
        False,
        "--non-interactive",
        "--yes",
        "-y",
        help="Run from flags without prompts.",
    ),
    plain: bool = typer.Option(
        False,
        "--plain",
        help="Use simple terminal output instead of the live Rich layout.",
    ),
    save_report: bool = typer.Option(
        False,
        "--save-report",
        help="Save report without prompting in non-interactive mode.",
    ),
    save_path: Optional[Path] = typer.Option(
        None,
        "--save-path",
        help="Report output directory for --save-report.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Validate configuration and data access without executing the LLM pipeline.",
    ),
):
    if clear_checkpoints:
        service = ResearchService()
        clear_fn = getattr(service, "clear_checkpoints", None)
        n = clear_fn(DEFAULT_CONFIG["data_cache_dir"]) if callable(clear_fn) else 0
        console.print(f"[yellow]Cleared {n} checkpoint(s).[/yellow]")
        if not (non_interactive or plain or ticker):
            return
    if non_interactive or plain or ticker:
        if not ticker:
            raise typer.BadParameter(
                "--ticker is required for non-interactive research."
            )
        selections = selections_from_cli_options(
            ticker=ticker,
            analysis_date=analysis_date or datetime.datetime.now().strftime("%Y-%m-%d"),
            asset_class=asset_class,
            market_type=market_type,
            exchange=exchange,
            analysts=analysts,
            research_depth=research_depth,
            llm_provider=llm_provider,
            profile=profile,
            backend_url=backend_url,
            quick_model=quick_model,
            deep_model=deep_model,
            output_language=output_language,
        )
        run_analysis(
            checkpoint=checkpoint,
            selections=selections,
            non_interactive=True,
            plain=True,
            save_report=save_report,
            save_path=save_path,
            dry_run=dry_run,
        )
        return
    run_analysis(checkpoint=checkpoint, dry_run=dry_run)


# ---------------------------------------------------------------------------
# Research namespace
# ---------------------------------------------------------------------------

research_app = typer.Typer(
    help="Research workflow aliases for runs, workspaces, watchlists, theses, and signals."
)


@research_app.command("run")
def research_run(
    ticker: Optional[str] = typer.Argument(
        None,
        help="Ticker to research, e.g. BTC/USDT. Omit for the interactive wizard.",
    ),
    analysis_date: Optional[str] = typer.Option(
        None, "--date", help="Analysis date (YYYY-MM-DD)."
    ),
    exchange: Optional[str] = typer.Option(
        None, "--exchange", help="Crypto exchange id."
    ),
    market_type: str = typer.Option(
        "spot",
        "--market-type",
        help="Research market type for crypto setups: spot or perp.",
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts: market,social,news,onchain.",
    ),
    research_depth: int = typer.Option(1, "--research-depth", min=1),
    llm_provider: Optional[str] = typer.Option(None, "--llm-provider"),
    profile: Optional[str] = typer.Option(
        None, "--profile", "-p", help="Configuration profile to load."
    ),
    backend_url: Optional[str] = typer.Option(None, "--backend-url"),
    quick_model: Optional[str] = typer.Option(None, "--quick-model"),
    deep_model: Optional[str] = typer.Option(None, "--deep-model"),
    output_language: str = typer.Option("English", "--output-language"),
    checkpoint: bool = typer.Option(False, "--checkpoint"),
    yes: bool = typer.Option(
        False,
        "--yes",
        "--non-interactive",
        "-y",
        help="Run from arguments/options without prompts.",
    ),
    plain: bool = typer.Option(
        True,
        "--plain/--live",
        help="Use plain output by default for research aliases.",
    ),
    save_report: bool = typer.Option(False, "--save-report"),
    save_path: Optional[Path] = typer.Option(None, "--save-path"),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Validate configuration and data access without executing the LLM pipeline.",
    ),
) -> None:
    """Run research through the terminal-first research namespace."""
    if not ticker:
        if yes:
            raise typer.BadParameter("Ticker is required when using --yes.")
        run_analysis(checkpoint=checkpoint, dry_run=dry_run)
        return
    selections = selections_from_cli_options(
        ticker=ticker,
        analysis_date=analysis_date or datetime.datetime.now().strftime("%Y-%m-%d"),
        asset_class="crypto",
        market_type=market_type,
        exchange=exchange,
        analysts=analysts,
        research_depth=research_depth,
        llm_provider=llm_provider,
        profile=profile,
        backend_url=backend_url,
        quick_model=quick_model,
        deep_model=deep_model,
        output_language=output_language,
    )
    run_analysis(
        checkpoint=checkpoint,
        selections=selections,
        non_interactive=True,
        plain=plain,
        save_report=save_report,
        save_path=save_path,
        dry_run=dry_run,
    )


@research_app.command("workspace")
def research_workspace(
    run_id: str = typer.Argument(..., help="Research run id."),
    json_out: bool = typer.Option(
        False, "--json", help="Emit workspace snapshot as JSON."
    ),
    plain: bool = typer.Option(False, "--plain", help="Print workspace as plain text."),
) -> None:
    """Alias for journal workspace."""
    journal_workspace(run_id, json_out=json_out, plain=plain)


@research_app.command("brief")
def research_brief(
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
    alerts_limit: int = typer.Option(20, "--alerts-limit", min=1),
    brief_date: Optional[str] = typer.Option(
        None, "--date", help="Brief date (YYYY-MM-DD)."
    ),
    evaluate_snapshots: bool = typer.Option(
        True,
        "--evaluate-snapshots/--no-evaluate-snapshots",
        help="Evaluate saved scenarios using latest persisted snapshots.",
    ),
    save: bool = typer.Option(
        True,
        "--save/--no-save",
        help="Persist the generated brief.",
    ),
) -> None:
    """Create a daily market brief from the research namespace."""
    market_brief_daily(
        watchlist=watchlist,
        brief_date=brief_date,
        alerts_limit=alerts_limit,
        evaluate_snapshots=evaluate_snapshots,
        save=save,
    )


research_app.add_typer(journal_app, name="journal")
research_app.add_typer(thesis_app, name="thesis")
research_app.add_typer(signals_app, name="signals")
research_app.add_typer(watchlist_app, name="watchlist")
research_app.add_typer(brief_app, name="briefs")
research_app.add_typer(evaluate_app, name="evaluate")
research_app.add_typer(replay_app, name="replay")
app.add_typer(research_app, name="research")
app.add_typer(replay_app, name="replay")
research_app.add_typer(diff_app, name="diff")


engine_app = typer.Typer(help="Worker-ready Python research engine contract.")


@engine_app.command("run")
def engine_run(
    request: Path = typer.Option(
        ...,
        "--request",
        "-r",
        exists=True,
        dir_okay=False,
        readable=True,
        help="JSON request file for the engine worker contract.",
    ),
) -> None:
    """Run the Python research engine from a structured JSON request."""
    from tradingagents.engine import run_engine_request_file

    result = run_engine_request_file(request)
    console.print_json(data=result.model_dump(mode="json"))
    if result.status != "completed":
        raise typer.Exit(1)


app.add_typer(engine_app, name="engine")


@app.callback(invoke_without_command=True)
def _default_command(ctx: Context) -> None:
    """Run interactive analysis when no subcommand is given (same as ``analyze``)."""
    if ctx.invoked_subcommand is None:
        run_analysis(checkpoint=False)


# ---------------------------------------------------------------------------
# Backward-compatible module-level wrapper
# ---------------------------------------------------------------------------


def run_analysis(
    checkpoint: bool = False,
    *,
    selections: dict | None = None,
    non_interactive: bool = False,
    plain: bool = False,
    save_report: bool = False,
    save_path: Path | None = None,
    dry_run: bool = False,
):
    """Thin wrapper that injects ``main.ResearchService``.

    This is intentionally a module-level function (not a direct import from
    ``orchestrator``) so that tests can monkeypatch ``main.ResearchService``
    and the patched class flows through to the orchestrator.
    """
    return _run_analysis(
        checkpoint=checkpoint,
        selections=selections,
        non_interactive=non_interactive,
        plain=plain,
        save_report=save_report,
        save_path=save_path,
        dry_run=dry_run,
        _research_service_class=ResearchService,
    )


if __name__ == "__main__":
    app()
