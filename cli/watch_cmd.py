"""Thesis watchlist placeholder.

The previous watch command mixed analysis, execution, and live position
monitoring. That flow is intentionally removed. The replacement should track
saved theses and alert when invalidation conditions are met, without placing
or closing orders.
"""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel

console = Console()
app = typer.Typer()


@app.command(name="watch")
def watch(
    ticker: str = typer.Argument(..., help="Trading pair to watch, e.g. BTC/USDT"),
):
    """Show the planned direction for future thesis monitoring."""
    console.print(Panel(
        f"[bold yellow]Watchlists are being rebuilt for thesis tracking.[/bold yellow]\n\n"
        f"Requested symbol: [cyan]{ticker}[/cyan]\n\n"
        "Next target: active thesis timeline, signal changes, invalidation "
        "alerts, and market brief integration. This command does not execute "
        "or auto-close trades.",
        title="Thesis Watchlist",
        border_style="yellow",
    ))


def register_watch(parent_app: typer.Typer) -> None:
    """Mount the watch command group on the main CLI app."""
    parent_app.add_typer(app)


if __name__ == "__main__":
    app()
