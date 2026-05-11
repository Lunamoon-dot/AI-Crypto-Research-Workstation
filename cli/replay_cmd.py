"""CLI commands for historical research replay (Phase 9D).

Reruns the full multi-agent research pipeline for past dates with
point-in-time data guardrails — no lookahead, no future data leakage.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.graph.historical_replay import HistoricalReplay

replay_app = typer.Typer(help="Historical research replay (no-lookahead)")
console = Console()


@replay_app.command("single")
def replay_single(
    ticker: str = typer.Argument(..., help="Ticker to replay, e.g. BTC/USDT"),
    anchor_date: str = typer.Argument(
        ..., help="Historical date to replay (YYYY-MM-DD)"
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts to include.",
    ),
    lookback_days: int = typer.Option(
        30, "--lookback", "-l", min=1, max=365, help="Lookback window in days."
    ),
    debate_rounds: int = typer.Option(
        1, "--debate-rounds", min=1, max=5, help="Max debate rounds."
    ),
    risk_rounds: int = typer.Option(
        1, "--risk-rounds", min=1, max=5, help="Max risk discussion rounds."
    ),
    output_language: str = typer.Option(
        "English", "--language", help="Output language for reports."
    ),
) -> None:
    """Replay research for a single ticker on a single historical date.

    Example::

        tradingagents replay single BTC/USDT 2025-01-15 --lookback 60
    """
    try:
        anchor = date.fromisoformat(anchor_date)
    except ValueError:
        console.print(f"[red]Invalid date format: {anchor_date}. Use YYYY-MM-DD.[/red]")
        raise typer.Exit(code=1)

    if anchor > date.today():
        console.print("[red]Anchor date must be in the past.[/red]")
        raise typer.Exit(code=1)

    selected = [a.strip() for a in analysts.split(",") if a.strip()]

    console.print(
        Panel(
            f"Replaying [bold]{ticker}[/bold] as of [cyan]{anchor_date}[/cyan]\n"
            f"Lookback: {lookback_days}d | Analysts: {', '.join(selected)}",
            title="Historical Replay",
            border_style="cyan",
        )
    )

    replay = HistoricalReplay()
    # Override lookback
    replay.config.setdefault("historical_data", {})[
        "default_lookback_days"
    ] = lookback_days

    result = replay.run(
        ticker=ticker,
        anchor_date=anchor,
        selected_analysts=selected,
        max_debate_rounds=debate_rounds,
        max_risk_rounds=risk_rounds,
        output_language=output_language,
    )

    if result.success:
        table = Table(title="Replay Result", box=box.SIMPLE)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="white")
        table.add_row("Ticker", result.ticker)
        table.add_row("Date", result.anchor_date.isoformat())
        table.add_row("Signal", f"[bold green]{result.final_signal}[/bold green]")
        table.add_row("Data calls", str(len(result.data_call_log)))
        console.print(table)

        if result.thesis_text:
            console.print(
                Panel(
                    result.thesis_text[:1500],
                    title="Thesis (excerpt)",
                    border_style="green",
                )
            )
    else:
        console.print(f"[red]Replay failed:[/red]")
        for err in result.errors:
            console.print(f"  • {err}")


@replay_app.command("batch")
def replay_batch(
    ticker: str = typer.Argument(..., help="Ticker to replay"),
    start_date: str = typer.Argument(..., help="Start date (YYYY-MM-DD)"),
    end_date: str = typer.Argument(
        ..., help="End date (YYYY-MM-DD), inclusive"
    ),
    step_days: int = typer.Option(
        7, "--step", "-s", min=1, max=90, help="Days between replay dates."
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts.",
    ),
    lookback_days: int = typer.Option(
        30, "--lookback", "-l", min=1, max=365, help="Lookback window in days."
    ),
    debate_rounds: int = typer.Option(
        1, "--debate-rounds", min=1, max=5, help="Max debate rounds."
    ),
) -> None:
    """Replay research for a ticker across a range of historical dates.

    Example::

        tradingagents replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7
    """
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        console.print("[red]Invalid date format. Use YYYY-MM-DD.[/red]")
        raise typer.Exit(code=1)

    if start > end:
        console.print("[red]Start date must be before end date.[/red]")
        raise typer.Exit(code=1)
    if end > date.today():
        console.print("[red]End date must be in the past.[/red]")
        raise typer.Exit(code=1)

    # Build date list
    dates: list[date] = []
    current = start
    while current <= end:
        dates.append(current)
        current += timedelta(days=step_days)

    selected = [a.strip() for a in analysts.split(",") if a.strip()]

    console.print(
        Panel(
            f"Batch replay: [bold]{ticker}[/bold]\n"
            f"Range: {start_date} → {end_date} (step {step_days}d)\n"
            f"Total dates: {len(dates)} | Lookback: {lookback_days}d\n"
            f"Analysts: {', '.join(selected)}",
            title="Historical Batch Replay",
            border_style="cyan",
        )
    )

    replay = HistoricalReplay()
    replay.config.setdefault("historical_data", {})[
        "default_lookback_days"
    ] = lookback_days

    results = replay.run_batch(
        ticker=ticker,
        dates=dates,
        selected_analysts=selected,
    )

    # Summary table
    table = Table(title=f"Batch Results — {ticker}", box=box.SIMPLE)
    table.add_column("Date", style="cyan")
    table.add_column("Signal", style="bold")
    table.add_column("Status")

    hit_count = 0
    for r in results:
        status_style = "green" if r.success else "red"
        status_text = "✓" if r.success else "✗"
        table.add_row(
            r.anchor_date.isoformat(),
            r.final_signal or "—",
            f"[{status_style}]{status_text}[/{status_style}]",
        )
        if r.success:
            hit_count += 1

    console.print(table)
    console.print(
        f"\nCompleted: [bold]{hit_count}/{len(results)}[/bold] successful"
    )
