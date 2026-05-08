"""Terminal home screen for the local research workspace."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services import JournalService, WatchlistService

console = Console()
app = typer.Typer()


@app.command(name="dashboard")
def dashboard(
    watchlist: str = typer.Option("default", "--watchlist", "-w", help="Watchlist name"),
    limit: int = typer.Option(5, "--limit", "-n", min=1, max=20, help="Recent runs to show"),
):
    """Show a local terminal home screen for research workflow state."""
    journal = JournalService(DEFAULT_CONFIG)
    watchlists = WatchlistService(DEFAULT_CONFIG)
    runs = journal.list_research_runs(limit=limit)
    brief = watchlists.build_brief(watchlist_name=watchlist, alerts_limit=5)

    console.print(
        Panel(
            f"Journal DB: [dim]{journal.db_path}[/dim]\n"
            f"Watchlist: [bold]{watchlist}[/bold] | "
            f"Items: [bold]{brief.item_count}[/bold] | "
            f"Theses: [bold cyan]{brief.thesis_count}[/bold cyan] | "
            f"Recent alerts: [bold]{len(brief.alerts)}[/bold]",
            title="Research Workspace",
            border_style="cyan",
        )
    )

    run_table = Table(title="Recent Research Runs")
    run_table.add_column("Run ID", style="dim")
    run_table.add_column("Symbol", style="cyan")
    run_table.add_column("Status")
    run_table.add_column("Started")
    run_table.add_column("Thesis")
    for run in runs:
        run_table.add_row(
            run.id or "",
            run.symbol,
            run.status.value,
            run.started_at.isoformat(),
            run.thesis_id or "-",
        )
    console.print(run_table)

    thesis_table = Table(title="Watched Theses")
    thesis_table.add_column("Thesis", style="dim")
    thesis_table.add_column("Symbol", style="cyan")
    thesis_table.add_column("Direction")
    thesis_table.add_column("Confidence")
    for thesis in brief.theses:
        thesis_table.add_row(
            thesis.thesis_id,
            thesis.symbol,
            thesis.direction,
            f"{thesis.confidence:.0%}" if thesis.confidence is not None else "-",
        )
    console.print(thesis_table)

    alert_lines = [f"- {alert.alert_type}: {alert.message}" for alert in brief.alerts]
    console.print(
        Panel(
            "\n".join(alert_lines) if alert_lines else "No recent watchlist alerts.",
            title="Recent Alerts",
            border_style="yellow",
        )
    )
    console.print(
        Panel(
            "- tradingagents research run\n"
            "- tradingagents journal workspace <run_id>\n"
            "- tradingagents watchlist brief\n"
            "- tradingagents watchlist check",
            title="Next Useful Commands",
            border_style="blue",
        )
    )


def register_dashboard(parent_app: typer.Typer) -> None:
    """Mount the dashboard command on the main CLI app."""
    parent_app.add_typer(app)


if __name__ == "__main__":
    app()
