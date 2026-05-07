"""Configuration profile management commands."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from pathlib import Path
import yaml

from tradingagents.config_manager import (
    save_profile,
    list_profiles,
    load_profile,
    delete_profile,
)

console = Console()
config_app = typer.Typer(help="Manage configuration profiles.")


@config_app.command("save")
def config_save(
    profile_name: str = typer.Argument(..., help="Name for the saved profile"),
    source_profile: str = typer.Option(
        None, "--profile", "-p",
        help="Base profile to capture (use current selections if omitted).",
    ),
):
    """Save current configuration as a named profile.

    The profile stores only your custom overrides — default values are
    inherited automatically.
    """
    if source_profile:
        config = load_profile(source_profile)
        console.print(f"[dim]Loaded existing profile '{source_profile}' as base.[/dim]")
    else:
        from tradingagents.default_config import DEFAULT_CONFIG
        config = DEFAULT_CONFIG.copy()
        console.print("[dim]Using default configuration as base.[/dim]")

    path = save_profile(config, profile_name)
    console.print(f"[green]Profile saved:[/green] {profile_name}")
    console.print(f"[dim]Location:[/dim] {path}")


@config_app.command("list")
def config_list():
    """List all saved configuration profiles."""
    profiles = list_profiles()
    if not profiles:
        console.print("[yellow]No saved profiles.[/yellow]")
        console.print(f"[dim]Profiles are stored in ~/.tradingagents/profiles/[/dim]")
        return

    table = Table(title="Saved Configuration Profiles")
    table.add_column("Profile Name", style="cyan")
    table.add_column("File")

    for name in profiles:
        path = Path.home() / ".tradingagents" / "profiles" / f"{name}.yaml"
        table.add_row(name, str(path))

    console.print(table)
    console.print(f"\n[dim]Use 'tradingagents config-show <name>' to view details.[/dim]")


@config_app.command("show")
def config_show(
    profile_name: str = typer.Argument(..., help="Profile name to display"),
    full: bool = typer.Option(
        False, "--full",
        help="Show the fully-resolved config (with defaults), not just overrides.",
    ),
):
    """Display the contents of a saved profile."""
    if full:
        config = load_profile(profile_name)
        yaml_str = yaml.safe_dump(config, default_flow_style=False,
                                  sort_keys=False, allow_unicode=True)
    else:
        from pathlib import Path as P
        path = P.home() / ".tradingagents" / "profiles" / f"{profile_name}.yaml"
        if not path.exists():
            console.print(f"[red]Profile '{profile_name}' not found.[/red]")
            raise typer.Exit(code=1)
        yaml_str = path.read_text(encoding="utf-8")

    console.print(Panel(
        Syntax(yaml_str, "yaml", theme="monokai", line_numbers=False),
        title=f"Profile: {profile_name}",
        border_style="cyan",
    ))


@config_app.command("delete")
def config_delete(
    profile_name: str = typer.Argument(..., help="Profile name to delete"),
    force: bool = typer.Option(
        False, "--force", "-f", help="Delete without confirmation.",
    ),
):
    """Delete a saved configuration profile."""
    if not force:
        confirm = typer.confirm(
            f"Delete profile '{profile_name}'? This cannot be undone."
        )
        if not confirm:
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit()

    if delete_profile(profile_name):
        console.print(f"[green]Deleted profile:[/green] {profile_name}")
    else:
        console.print(f"[yellow]Profile '{profile_name}' not found.[/yellow]")


def register_config(parent_app: typer.Typer) -> None:
    """Mount the config command group on the main CLI app."""
    parent_app.add_typer(config_app, name="config")
