"""Research workspace dashboard placeholder.

The old dashboard displayed trading account state and trade history. That was
too execution-centric for the product direction. This command is now reserved
for the research workstation dashboard: watchlists, active theses, journal
timeline, signal changes, and market briefs.
"""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel

console = Console()
app = typer.Typer()


@app.command(name="dashboard")
def dashboard():
    """Show the planned research dashboard direction."""
    console.print(Panel(
        "[bold yellow]Research dashboard is being rebuilt.[/bold yellow]\n\n"
        "Target views:\n"
        "- watchlists\n"
        "- active theses\n"
        "- signal changes\n"
        "- decision journal timeline\n"
        "- market brief\n\n"
        "Trading-account and live-execution views were removed from this "
        "command during the safety reset.",
        title="Research Workspace",
        border_style="yellow",
    ))


def register_dashboard(parent_app: typer.Typer) -> None:
    """Mount the dashboard command on the main CLI app."""
    parent_app.add_typer(app)


if __name__ == "__main__":
    app()
