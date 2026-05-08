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
from tradingagents.dataflows.health import provider_health_snapshot
from tradingagents.exceptions import ConfigurationError

console = Console()
config_app = typer.Typer(help="Manage configuration profiles.")


def _profile_file_for_display(profile_name: str) -> Path | None:
    base = Path.home() / ".tradingagents" / "profiles"
    for ext in (".yaml", ".yml", ".toml"):
        path = base / f"{profile_name}{ext}"
        if path.exists():
            return path
    return None


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
        try:
            config = load_profile(source_profile)
        except ConfigurationError as exc:
            console.print(f"[red]Invalid profile '{source_profile}': {exc}[/red]")
            raise typer.Exit(code=1)
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
        path = _profile_file_for_display(name)
        table.add_row(name, str(path) if path else "(missing)")

    console.print(table)
    console.print(f"\n[dim]Use 'tradingagents config show <name>' to view details.[/dim]")


@config_app.command("show")
def config_show(
    profile_name: str = typer.Argument(..., help="Profile name to display"),
    full: bool = typer.Option(
        False, "--full",
        help="Show the fully-resolved config (with defaults), not just overrides.",
    ),
):
    """Display the contents of a saved profile."""
    path: Path | None = None
    if full:
        try:
            config = load_profile(profile_name)
        except ConfigurationError as exc:
            console.print(f"[red]Invalid profile '{profile_name}': {exc}[/red]")
            raise typer.Exit(code=1)
        yaml_str = yaml.safe_dump(config, default_flow_style=False,
                                  sort_keys=False, allow_unicode=True)
    else:
        path = _profile_file_for_display(profile_name)
        if path is None:
            console.print(f"[red]Profile '{profile_name}' not found.[/red]")
            raise typer.Exit(code=1)
        yaml_str = path.read_text(encoding="utf-8")

    syntax_lang = "toml" if (not full and path is not None and path.suffix == ".toml") else "yaml"
    console.print(Panel(
        Syntax(yaml_str, syntax_lang, theme="monokai", line_numbers=False),
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


@config_app.command("health")
def config_health(
    profile_name: str = typer.Option(
        None,
        "--profile",
        "-p",
        help="Inspect provider health using a specific profile.",
    ),
):
    """Show provider enable/disable health and runtime resilience settings."""
    if profile_name:
        try:
            cfg = load_profile(profile_name)
        except ConfigurationError as exc:
            console.print(f"[red]Invalid profile '{profile_name}': {exc}[/red]")
            raise typer.Exit(code=1)
    else:
        cfg = None
    snapshot = provider_health_snapshot(cfg)

    providers_table = Table(title="Provider Status")
    providers_table.add_column("Provider", style="cyan")
    providers_table.add_column("Status")
    for row in snapshot["providers"]:
        status = row["status"]
        color = "green" if status == "enabled" else "red"
        providers_table.add_row(row["vendor"], f"[{color}]{status}[/{color}]")
    console.print(providers_table)

    cat_table = Table(title="Category Routing")
    cat_table.add_column("Category", style="cyan")
    cat_table.add_column("Configured")
    cat_table.add_column("Enabled")
    cat_table.add_column("Disabled")
    for category, details in snapshot["categories"].items():
        cat_table.add_row(
            category,
            ", ".join(details["configured"]) or "-",
            ", ".join(details["enabled"]) or "-",
            ", ".join(details["disabled"]) or "-",
        )
    console.print(cat_table)

    runtime = snapshot.get("provider_runtime", {}) or {}
    console.print(
        Panel(
            "\n".join(
                [
                    f"enabled: {runtime.get('enabled', True)}",
                    f"timeout_sec: {runtime.get('timeout_sec', 20.0)}",
                    f"retries: {runtime.get('retries', 2)}",
                    f"backoff_base_sec: {runtime.get('backoff_base_sec', 0.35)}",
                    f"backoff_max_sec: {runtime.get('backoff_max_sec', 2.5)}",
                    f"rate_limit_per_sec: {runtime.get('rate_limit_per_sec', 8.0)}",
                ]
            ),
            title="Provider Runtime Resilience",
            border_style="magenta",
        )
    )


def register_config(parent_app: typer.Typer) -> None:
    """Mount the config command group on the main CLI app."""
    parent_app.add_typer(config_app, name="config")
