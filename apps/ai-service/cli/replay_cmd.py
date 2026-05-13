"""CLI commands for historical research replay (Phase 9D).

Reruns the full multi-agent research pipeline for past dates with
point-in-time data guardrails — no lookahead, no future data leakage.

Phase 9C: Provider capability report and strict guard mode.
"""

from __future__ import annotations

from datetime import date, timedelta

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.dataflows.historical_contract import (
    PROVIDER_DECLARATIONS,
    ProviderHistoricalDeclaration,
)
from tradingagents.graph.historical_replay import HistoricalReplay

from cli.json_emit import print_json_stdout

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
    strict: bool = typer.Option(
        True,
        "--strict/--research-simulation",
        help="Require strict point-in-time replay by default. Use "
        "--research-simulation only for exploratory runs that may accept "
        "HYBRID provider semantics.",
    ),
) -> None:
    """Replay research for a single ticker on a single historical date.

    Example::

        lunacrypto replay single BTC/USDT 2025-01-15 --lookback 60
        lunacrypto replay single BTC/USDT 2025-01-15 --strict
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

    strict_label = (
        " [red]STRICT MODE[/red]" if strict else " [yellow]RESEARCH SIMULATION[/yellow]"
    )
    console.print(
        Panel(
            f"Replaying [bold]{ticker}[/bold] as of [cyan]{anchor_date}[/cyan]\n"
            f"Lookback: {lookback_days}d | Analysts: {', '.join(selected)}{strict_label}",
            title="Historical Replay",
            border_style="red" if strict else "yellow",
        )
    )

    replay = HistoricalReplay()
    # Override lookback
    historical_cfg = replay.config.setdefault("historical_data", {})
    historical_cfg["default_lookback_days"] = lookback_days
    historical_cfg["strict_mode"] = strict

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
        console.print("[red]Replay failed:[/red]")
        for err in result.errors:
            console.print(f"  • {err}")


@replay_app.command("batch")
def replay_batch(
    ticker: str = typer.Argument(..., help="Ticker to replay"),
    start_date: str = typer.Argument(..., help="Start date (YYYY-MM-DD)"),
    end_date: str = typer.Argument(..., help="End date (YYYY-MM-DD), inclusive"),
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
    strict: bool = typer.Option(
        True,
        "--strict/--research-simulation",
        help="Require strict point-in-time replay by default. Use "
        "--research-simulation only for exploratory runs that may accept "
        "HYBRID provider semantics.",
    ),
) -> None:
    """Replay research for a ticker across a range of historical dates.

    Example::

        lunacrypto replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7
        lunacrypto replay batch BTC/USDT 2025-01-01 2025-03-31 --step 7 --strict
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
    strict_label = (
        " [red]STRICT MODE[/red]" if strict else " [yellow]RESEARCH SIMULATION[/yellow]"
    )

    console.print(
        Panel(
            f"Batch replay: [bold]{ticker}[/bold]\n"
            f"Range: {start_date} → {end_date} (step {step_days}d)\n"
            f"Total dates: {len(dates)} | Lookback: {lookback_days}d\n"
            f"Analysts: {', '.join(selected)}{strict_label}",
            title="Historical Batch Replay",
            border_style="red" if strict else "yellow",
        )
    )

    replay = HistoricalReplay()
    historical_cfg = replay.config.setdefault("historical_data", {})
    historical_cfg["default_lookback_days"] = lookback_days
    historical_cfg["strict_mode"] = strict

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
    console.print(f"\nCompleted: [bold]{hit_count}/{len(results)}[/bold] successful")


# ---------------------------------------------------------------------------
# Phase 9C: Provider capability report
# ---------------------------------------------------------------------------


@replay_app.command("capabilities")
def replay_capabilities(
    vendor: str = typer.Option(
        "",
        "--vendor",
        "-v",
        help="Filter by vendor (ccxt, coingecko, or empty for all).",
    ),
    json_out: bool = typer.Option(
        False,
        "--json",
        help="Emit capabilities as structured JSON.",
    ),
) -> None:
    """Show data provider capabilities for historical replay.

    Displays each provider's declared timestamp semantics, endpoint
    lookback range, granularity, and known gaps — the contract that
    governs whether a replay can be point-in-time trustworthy.

    Example::

        lunacrypto replay capabilities
        lunacrypto replay capabilities --vendor ccxt --json
    """
    vendors_to_show: dict[str, ProviderHistoricalDeclaration] = {}
    if vendor:
        decl = PROVIDER_DECLARATIONS.get(vendor.lower())
        if decl is None:
            console.print(
                f"[red]Unknown vendor '{vendor}'.[/red] "
                f"Known: {', '.join(PROVIDER_DECLARATIONS.keys())}"
            )
            raise typer.Exit(code=1)
        vendors_to_show[vendor.lower()] = decl
    else:
        vendors_to_show = dict(PROVIDER_DECLARATIONS)

    if json_out:
        payload: dict = {}
        for vname, decl in vendors_to_show.items():
            payload[vname] = {
                "vendor": decl.vendor,
                "default_semantics": decl.default_semantics.value,
                "endpoints": [
                    {
                        "method": ep.method_name,
                        "semantics": ep.timestamp_semantics.value,
                        "max_lookback_days": ep.max_lookback_days,
                        "granularity": ep.granularity,
                        "notes": ep.notes,
                    }
                    for ep in decl.endpoints
                ],
                "known_gaps": decl.known_gaps,
            }
        print_json_stdout({"providers": payload})
        return

    for vname, decl in vendors_to_show.items():
        sem_color = {
            "as_of": "green",
            "hybrid": "yellow",
            "latest": "red",
        }
        table = Table(
            title=f"Provider: [bold]{vname}[/bold] "
            f"(default: [{sem_color.get(decl.default_semantics.value, 'white')}]"
            f"{decl.default_semantics.value}[/{sem_color.get(decl.default_semantics.value, 'white')}])",
            box=box.SIMPLE,
        )
        table.add_column("Method", style="cyan")
        table.add_column("Semantics", style="bold")
        table.add_column("Lookback", justify="right")
        table.add_column("Granularity")
        table.add_column("Notes")

        for ep in decl.endpoints:
            sem_style = sem_color.get(ep.timestamp_semantics.value, "white")
            table.add_row(
                ep.method_name,
                f"[{sem_style}]{ep.timestamp_semantics.value}[/{sem_style}]",
                f"{ep.max_lookback_days}d" if ep.max_lookback_days > 0 else "live",
                ep.granularity,
                ep.notes[:80],
            )
        console.print(table)

        if decl.known_gaps:
            console.print("[dim]Known gaps:[/dim]")
            for gap in decl.known_gaps:
                console.print(f"  [dim]• {gap}[/dim]")
        console.print()
