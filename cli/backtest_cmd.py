"""Historical thesis evaluation CLI command.

This is not a broker-accurate strategy backtester. It replays research dates
and evaluates subsequent thesis outcomes. Execution metrics are rough research
diagnostics only until a real broker simulator exists.
"""

from __future__ import annotations

import typer
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from tqdm import tqdm

from tradingagents.backtesting.runner import BacktestRunner
from tradingagents.config_manager import resolve_config
from tradingagents.config.secrets import get_default_secrets
from tradingagents.domain import EvaluationMetricsRow, ThesisEvaluation
from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS
from tradingagents.services import EvaluationService
from cli.preflight import check_api_keys

console = Console()
backtest_app = typer.Typer(
    help="Historical thesis evaluation.",
    invoke_without_command=True,
    no_args_is_help=True,
)


@backtest_app.callback()
def backtest_default():
    """Show help when no subcommand is given."""
    pass


@backtest_app.command(name="thesis")
def evaluate_thesis(
    thesis_id: str = typer.Argument(..., help="Saved thesis id to evaluate."),
    window_days: int = typer.Option(
        14,
        "--window-days",
        "-w",
        min=1,
        help="Forward OHLCV window used for thesis-quality evaluation.",
    ),
    record_review: bool = typer.Option(
        False,
        "--record-review",
        help="Also save an OutcomeReview from this evaluation.",
    ),
):
    """Evaluate one saved thesis over a forward OHLCV window."""
    try:
        evaluation = EvaluationService().evaluate_thesis(
            thesis_id,
            window_days=window_days,
            record_review=record_review,
        )
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    _display_thesis_evaluation(evaluation)


@backtest_app.command(name="batch")
def evaluate_batch(
    symbol: str | None = typer.Option(None, "--symbol", help="Filter saved theses by symbol."),
    limit: int = typer.Option(20, "--limit", "-n", min=1, help="Maximum saved theses to evaluate."),
    window_days: int = typer.Option(
        14,
        "--window-days",
        "-w",
        min=1,
        help="Forward OHLCV window used for each thesis.",
    ),
):
    """Evaluate recent saved theses without replaying historical research."""
    evaluations = EvaluationService().evaluate_batch(
        symbol=symbol,
        limit=limit,
        window_days=window_days,
    )
    _display_evaluation_table(evaluations, title="Historical Thesis Quality Evaluation")


@backtest_app.command(name="results")
def evaluation_results(
    thesis_id: str | None = typer.Option(None, "--thesis-id", help="Filter by thesis id."),
    symbol: str | None = typer.Option(None, "--symbol", help="Filter by symbol."),
    limit: int = typer.Option(50, "--limit", "-n", min=1),
):
    """List persisted thesis evaluation results."""
    evaluations = EvaluationService().list_evaluations(
        thesis_id=thesis_id,
        symbol=symbol,
        limit=limit,
    )
    _display_evaluation_table(evaluations, title="Saved Thesis Evaluations")


@backtest_app.command(name="analytics")
def evaluation_analytics(
    symbol: str | None = typer.Option(None, "--symbol", help="Filter evaluations by symbol."),
    limit: int = typer.Option(300, "--limit", "-n", min=1),
):
    """Aggregate thesis-quality analytics by symbol/setup/signal/agent/confidence."""
    analytics = EvaluationService().build_analytics(symbol=symbol, limit=limit)
    _display_analytics(analytics)


@backtest_app.command()
def run(
    ticker: str = typer.Option(
        ..., "--ticker", "-t",
        help="Trading pair to evaluate (e.g., BTC/USDT).",
    ),
    start_date: str = typer.Option(
        ..., "--start",
        help="Start date YYYY-MM-DD.",
    ),
    end_date: str = typer.Option(
        ..., "--end",
        help="End date YYYY-MM-DD.",
    ),
    frequency: str = typer.Option(
        "weekly", "--frequency", "-f",
        help="Trading frequency: daily, weekly, biweekly, monthly, quarterly.",
    ),
    holding_days: int = typer.Option(
        5, "--holding-days", "-h",
        help="Days to hold after each signal.",
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain", "--analysts", "-a",
        help="Comma-separated analysts: market,social,news,onchain.",
    ),
    profile: str = typer.Option(
        None, "--profile", "-p",
        help="Config profile to use.",
    ),
    output: str = typer.Option(
        None, "--output", "-o",
        help="Output directory for results.",
    ),
    provider: str = typer.Option(
        "deepseek", "--provider", "-m",
        help="LLM provider: openai, deepseek, google, anthropic, xai, etc.",
    ),
    backend_url: str = typer.Option(
        None, "--backend-url",
        help="Custom backend URL (overrides provider default).",
    ),
    deep_model: str = typer.Option(
        None, "--deep-model",
        help="Deep thinking model (e.g., deepseek-v4-pro).",
    ),
    quick_model: str = typer.Option(
        None, "--quick-model",
        help="Quick thinking model (e.g., deepseek-v4-flash).",
    ),
):
    """Run historical thesis evaluation.

    Evaluates AI research theses across a range of historical dates. This is
    not broker-accurate execution backtesting.
    """
    # Resolve config and merge CLI provider overrides
    config = resolve_config(profile=profile)
    config["llm_provider"] = provider
    if backend_url:
        config["backend_url"] = backend_url
    if deep_model:
        config["deep_think_llm"] = deep_model
    if quick_model:
        config["quick_think_llm"] = quick_model

    # Auto-populate model names from the provider catalog when not explicitly set
    provider_models = MODEL_OPTIONS.get(provider, {})
    if not deep_model and provider_models.get("deep"):
        config["deep_think_llm"] = provider_models["deep"][0][1]
    if not quick_model and provider_models.get("quick"):
        config["quick_think_llm"] = provider_models["quick"][0][1]

    # Ensure .env is loaded before checking API keys
    get_default_secrets()
    # Validate API key before launching (avoids cryptic 401 deep in the stack)
    preflight = check_api_keys(config["llm_provider"], config.get("backend_url"))
    if preflight["errors"]:
        for err in preflight["errors"]:
            console.print(f"[red]Error:[/red] {err}")
        raise typer.Exit(code=1)
    for warn in preflight["warnings"]:
        console.print(f"[yellow]Warning:[/yellow] {warn}")

    # Parse analysts
    analyst_keys = [a.strip().lower() for a in analysts.split(",")]

    # Validate
    valid_freqs = {"daily", "weekly", "biweekly", "monthly", "quarterly"}
    if frequency not in valid_freqs:
        console.print(f"[red]Invalid frequency '{frequency}'. Choose from: {valid_freqs}[/red]")
        raise typer.Exit(code=1)

    console.print(f"\n[bold cyan]Historical Thesis Evaluation: {ticker}[/bold cyan]")
    console.print(f"Period: {start_date} → {end_date}  |  "
                  f"Frequency: {frequency}  |  Holding: {holding_days}d")
    console.print(f"Provider: {provider}  |  Analysts: {', '.join(analyst_keys)}")
    console.print()
    console.print(
        "[dim]Each date runs the full multi-agent research pipeline. This does "
        "not simulate broker fills, slippage, fees, or funding.\nExpect ~2-5 "
        "minutes per date depending on provider speed. First date may be slower "
        "(cold start).[/dim]"
    )
    console.print()

    # Run backtest
    runner = BacktestRunner(
        config=config,
        ticker=ticker,
        start_date=start_date,
        end_date=end_date,
        frequency=frequency,
        holding_days=holding_days,
        selected_analysts=analyst_keys,
    )

    import time as _time

    # Map state keys to human-readable step names for progress display
    _STEP_ORDER = [
        ("market_report", "Market Analyst"),
        ("sentiment_report", "Social Analyst"),
        ("news_report", "News Analyst"),
        ("fundamentals_report", "Onchain Analyst"),
        ("investment_plan", "Research Debate"),
        ("trader_investment_plan", "Trader"),
        ("risk_debate_state", "Risk Debate"),
        ("final_trade_decision", "Portfolio Manager"),
    ]

    start_wall = None  # track wall-clock start for ETA after first run
    with tqdm(total=0, desc="Backtesting", unit="run", colour="cyan") as pbar:
        def _node_callback(chunk):
            """Update tqdm postfix with current pipeline step during long LLM runs."""
            for key, label in _STEP_ORDER:
                if not chunk.get(key):
                    pbar.set_postfix_str(f"{label}…")
                    break

        def _progress(date_str, idx, total):
            nonlocal start_wall
            pbar.total = total
            if idx == 0:
                start_wall = _time.time()
            if idx > 0 and start_wall is not None:
                elapsed = _time.time() - start_wall
                per_run = elapsed / idx
                remaining = per_run * (total - idx)
                pbar.set_description(
                    f"Backtesting {idx}/{total}"
                    f" (~{per_run:.0f}s/run, ~{remaining:.0f}s left)"
                )
            else:
                pbar.set_description("Backtesting (running first date…)")
            pbar.set_postfix_str(date_str)
            pbar.update(1)

        result = runner.run(callback=_progress, node_callback=_node_callback)

    console.print()

    # Display summary
    _display_result(result)

    # Save
    out_dir = Path(output) if output else None
    saved_path = runner.save(out_dir)
    console.print(f"\n[green]Results saved:[/green] {saved_path}")


def _display_result(result) -> None:
    """Render a Rich table with key backtest metrics."""
    table = Table(title="Historical Thesis Evaluation", header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green", justify="right")

    table.add_row("Total Runs", str(result.total_runs))
    table.add_row("Total Return", f"{result.total_return:+.2%}")
    table.add_row("Annualized Return", f"{result.annualized_return:+.2%}")
    table.add_row("Annualized Volatility", f"{result.annualized_volatility:+.2%}")
    table.add_row("Diagnostic Sharpe", f"{result.sharpe_ratio:.2f}")
    table.add_row("Max Drawdown", f"{result.max_drawdown:.2%}")
    table.add_row("Win Rate", f"{result.win_rate:.1%}")
    table.add_row("Avg Win", f"{result.avg_win:+.2%}")
    table.add_row("Avg Loss", f"{result.avg_loss:+.2%}")
    table.add_row("Profit Factor", f"{result.profit_factor:.2f}")
    table.add_row("Avg Alpha", f"{result.avg_alpha:+.2%}")
    table.add_row("Alpha Win Rate", f"{result.alpha_win_rate:.1%}")

    # Rating distribution
    if result.rating_distribution:
        dist_str = "  ".join(
            f"{k}: {v}" for k, v in sorted(result.rating_distribution.items())
        )
        table.add_row("Rating Distribution", dist_str)

    console.print(table)


def _display_thesis_evaluation(evaluation: ThesisEvaluation) -> None:
    console.print(
        Panel(
            "\n".join(
                [
                    f"Evaluation ID: {evaluation.id}",
                    f"Thesis: {evaluation.thesis_id}",
                    f"Symbol: {evaluation.symbol}",
                    f"Window: {evaluation.evaluation_start.isoformat()} -> {evaluation.evaluation_end.isoformat()} ({evaluation.window_days}d)",
                    f"Result: {evaluation.result.value}",
                    f"Target Hit: {'yes' if evaluation.target_hit else 'no'}",
                    f"Invalidated: {'yes' if evaluation.invalidated else 'no'}",
                    f"MFE: {_fmt_pct(evaluation.max_favorable_excursion)}",
                    f"MAE: {_fmt_pct(evaluation.max_adverse_excursion)}",
                    f"Time To Target: {_fmt_days(evaluation.time_to_target_days)}",
                    f"Time To Invalidation: {_fmt_days(evaluation.time_to_invalidation_days)}",
                    "",
                    "Note: this evaluates saved thesis quality from forward OHLCV. "
                    "It is not broker PnL and does not replay historical news/provider context.",
                ]
            ),
            title="Thesis Quality Evaluation",
            border_style="cyan",
        )
    )
    if evaluation.notes:
        console.print(
            Panel(
                "\n".join(f"- {note}" for note in evaluation.notes),
                title="Scope Notes",
                border_style="yellow",
            )
        )


def _display_evaluation_table(
    evaluations: list[ThesisEvaluation],
    *,
    title: str,
) -> None:
    table = Table(title=title, header_style="bold magenta")
    table.add_column("Evaluation", style="dim")
    table.add_column("Thesis", style="dim")
    table.add_column("Symbol", style="cyan")
    table.add_column("Result")
    table.add_column("MFE")
    table.add_column("MAE")
    table.add_column("Target")
    table.add_column("Invalidated")
    table.add_column("Window")
    for evaluation in evaluations:
        table.add_row(
            evaluation.id or "",
            evaluation.thesis_id,
            evaluation.symbol,
            evaluation.result.value,
            _fmt_pct(evaluation.max_favorable_excursion),
            _fmt_pct(evaluation.max_adverse_excursion),
            "yes" if evaluation.target_hit else "no",
            "yes" if evaluation.invalidated else "no",
            f"{evaluation.evaluation_start.isoformat()} -> {evaluation.evaluation_end.isoformat()}",
        )
    console.print(table)
    if not evaluations:
        console.print("[yellow]No thesis evaluations found.[/yellow]")


def _fmt_pct(value: float | None) -> str:
    return "-" if value is None else f"{value:+.2%}"


def _fmt_days(value: int | None) -> str:
    return "-" if value is None else f"{value}d"


def _display_analytics(analytics) -> None:
    overall = analytics.overall
    console.print(
        Panel(
            "\n".join(
                [
                    f"Sample Size: {overall.sample_size}",
                    f"Hit Rate: {_fmt_pct(overall.hit_rate)}",
                    f"Invalidation Rate: {_fmt_pct(overall.invalidation_rate)}",
                    f"Mixed Rate: {_fmt_pct(overall.mixed_rate)}",
                    f"Expired Rate: {_fmt_pct(overall.expired_rate)}",
                    f"Average MFE: {_fmt_pct(overall.average_mfe)}",
                    f"Average MAE: {_fmt_pct(overall.average_mae)}",
                ]
            ),
            title="Evaluation Analytics Overview",
            border_style="cyan",
        )
    )
    _print_metrics_rows("By Symbol", analytics.by_symbol)
    _print_metrics_rows("By Setup", analytics.by_setup)
    _print_metrics_rows("By Confidence Bucket", analytics.by_confidence_bucket)
    _print_metrics_rows("By Signal", analytics.by_signal)
    _print_metrics_rows("By Agent", analytics.by_agent)


def _print_metrics_rows(title: str, rows: list[EvaluationMetricsRow]) -> None:
    table = Table(title=title)
    table.add_column("Key", style="cyan")
    table.add_column("N")
    table.add_column("Hit")
    table.add_column("Invalidated")
    table.add_column("Mixed")
    table.add_column("Expired")
    table.add_column("MFE")
    table.add_column("MAE")
    for row in rows:
        table.add_row(
            row.key,
            str(row.sample_size),
            _fmt_pct(row.hit_rate),
            _fmt_pct(row.invalidation_rate),
            _fmt_pct(row.mixed_rate),
            _fmt_pct(row.expired_rate),
            _fmt_pct(row.average_mfe),
            _fmt_pct(row.average_mae),
        )
    console.print(table)


def register_backtest(parent_app: typer.Typer) -> None:
    """Mount the backtest command group on the main CLI app."""
    parent_app.add_typer(backtest_app, name="evaluate")
