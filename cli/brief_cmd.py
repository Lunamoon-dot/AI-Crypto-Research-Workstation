"""Market brief CLI commands."""

from __future__ import annotations

from datetime import date

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.domain import MarketBrief
from tradingagents.services import BriefService

console = Console()
app = typer.Typer(help="Create and inspect persisted daily market briefs.")


def _service() -> BriefService:
    return BriefService()


@app.command(name="daily")
def daily(
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
    brief_date: str | None = typer.Option(
        None, "--date", help="Brief date (YYYY-MM-DD)"
    ),
    alerts_limit: int = typer.Option(20, "--alerts-limit", min=1),
    evaluate_snapshots: bool = typer.Option(
        True,
        "--evaluate-snapshots/--no-evaluate-snapshots",
        help="Evaluate saved scenarios using latest persisted snapshots.",
    ),
    save: bool = typer.Option(
        True, "--save/--no-save", help="Persist the generated brief."
    ),
) -> None:
    """Create a daily market brief from persisted journal data."""
    brief = _service().create_daily_brief(
        watchlist_name=watchlist,
        brief_date=_parse_date(brief_date) if brief_date else None,
        alerts_limit=alerts_limit,
        evaluate_snapshots=evaluate_snapshots,
        save=save,
    )
    render_brief(brief)


@app.command(name="list")
def list_briefs(
    watchlist: str | None = typer.Option(
        None, "--watchlist", "-w", help="Filter by watchlist name"
    ),
    limit: int = typer.Option(20, "--limit", "-n", min=1),
) -> None:
    """List saved market briefs."""
    briefs = _service().list_briefs(watchlist_name=watchlist, limit=limit)
    table = Table(title="Market Briefs")
    table.add_column("Brief ID", style="dim")
    table.add_column("Date")
    table.add_column("Watchlist")
    table.add_column("Created")
    table.add_column("Previous")
    for brief in briefs:
        table.add_row(
            brief.id or "",
            brief.brief_date.isoformat(),
            brief.watchlist_name,
            brief.created_at.isoformat(),
            brief.previous_brief_id or "-",
        )
    console.print(table)


@app.command(name="show")
def show(
    brief_id: str = typer.Argument(..., help="Market brief id."),
) -> None:
    """Show a saved market brief."""
    brief = _service().get_brief(brief_id)
    if not brief:
        console.print(f"[red]Market brief not found:[/red] {brief_id}")
        raise typer.Exit(1)
    render_brief(brief)


def render_brief(brief: MarketBrief) -> None:
    """Render a structured market brief for terminal reading."""
    console.print(
        Panel(
            f"Brief ID: [dim]{brief.id or 'not saved'}[/dim]\n"
            f"Date: [bold]{brief.brief_date.isoformat()}[/bold]\n"
            f"Watchlist: [cyan]{brief.watchlist_name}[/cyan]\n"
            f"Previous: [dim]{brief.previous_brief_id or '-'}[/dim]\n\n"
            f"{brief.regime_summary}",
            title=brief.title,
            border_style="cyan",
        )
    )
    _print_assets(brief)
    _print_thesis_updates(brief)
    _print_list("Watchlist Changes", brief.watchlist_changes, "green")
    _print_list("Top Setups", brief.top_setups, "blue")
    _print_list("Top Risks", brief.top_risks, "yellow")
    _print_list("Memory", brief.memory_notes, "magenta")
    console.print(
        Panel(
            "- tradingagents brief daily\n"
            "- tradingagents watchlist brief\n"
            "- tradingagents watchlist check\n"
            "- tradingagents thesis list",
            title="Next Useful Commands",
            border_style="blue",
        )
    )


def _print_assets(brief: MarketBrief) -> None:
    table = Table(title="BTC / ETH / SOL And Watched Assets")
    table.add_column("Symbol", style="cyan")
    table.add_column("Price")
    table.add_column("Regime")
    table.add_column("Trend")
    table.add_column("Volatility")
    table.add_column("Source Timestamp")
    table.add_column("Change")
    for asset in brief.asset_summaries:
        table.add_row(
            asset.symbol,
            f"{asset.current_price:g}" if asset.current_price is not None else "-",
            asset.market_regime,
            asset.trend_direction,
            asset.volatility_regime,
            asset.source_timestamp.isoformat() if asset.source_timestamp else "-",
            _truncate(asset.change_from_previous or asset.summary, 80),
        )
    console.print(table)


def _print_thesis_updates(brief: MarketBrief) -> None:
    table = Table(title="Active Thesis Updates")
    table.add_column("Thesis", style="dim")
    table.add_column("Symbol", style="cyan")
    table.add_column("Direction")
    table.add_column("Setup")
    table.add_column("Confidence")
    table.add_column("Status")
    table.add_column("Invalidation")
    table.add_column("Update")
    for update in brief.thesis_updates:
        confidence = (
            f"{update.confidence:.0%}" if update.confidence is not None else "-"
        )
        table.add_row(
            update.thesis_id,
            update.symbol,
            update.direction,
            update.setup_type,
            confidence,
            update.status,
            update.invalidation_level or "-",
            _truncate(update.update, 90),
        )
    console.print(table)


def _print_list(title: str, values: list[str], border_style: str) -> None:
    body = "\n".join(f"- {value}" for value in values) if values else "-"
    console.print(Panel(body, title=title, border_style=border_style))


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise typer.BadParameter("Date must use YYYY-MM-DD.") from exc


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def register_brief(parent_app: typer.Typer) -> None:
    """Mount the brief command group on the main CLI app."""
    parent_app.add_typer(app, name="brief")
