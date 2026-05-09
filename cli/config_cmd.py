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
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.exceptions import ConfigurationError, HealthCheckError
from tradingagents.services.journal_service import resolve_journal_db_path

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
        help="Show the fully-resolved config (profile merged with defaults).",
    ),
    effective: bool = typer.Option(
        False, "--effective",
        help="Show the effective config (all layers: defaults + files + env + profile).",
    ),
):
    """Display the contents of a saved profile.

    Use --full to see the profile merged with defaults.
    Use --effective to see the full resolution chain (defaults + files + env vars + profile).
    """
    if effective:
        from tradingagents.config.loader import ConfigLoader

        loader = ConfigLoader()
        config = loader.load(profile=profile_name, fail_fast=False)
        display = _redact_secrets_in_config(config)
        yaml_str = yaml.safe_dump(display, default_flow_style=False,
                                  sort_keys=False, allow_unicode=True)
        console.print(Panel(
            Syntax(yaml_str, "yaml", theme="monokai", line_numbers=False),
            title=f"Effective Configuration (profile: {profile_name})",
            border_style="cyan",
        ))
        return

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

    # Live connectivity check
    try:
        from tradingagents.dataflows.interface import check_provider_health

        console.print("\n[bold]Live connectivity check...[/bold]")
        results = check_provider_health(timeout_sec=5.0)
        live_table = Table(title="Live Provider Connectivity")
        live_table.add_column("Provider", style="cyan")
        live_table.add_column("Status")
        for vendor, status in results.items():
            color = "green" if status == "healthy" else "red"
            live_table.add_row(vendor, f"[{color}]{status}[/{color}]")
        console.print(live_table)
    except HealthCheckError as exc:
        console.print(f"[red]Health check failed: {exc}[/red]")
        raise typer.Exit(code=2)
    except ImportError:
        console.print("[yellow]Live check skipped (CCXT not available).[/yellow]")
    except Exception as exc:
        console.print(f"[yellow]Live check unavailable: {exc}[/yellow]")

    # LLM connectivity check (optional)
    _check_llm_health(cfg)


def _check_llm_health(config: dict | None) -> None:
    """Test LLM provider connectivity with a minimal API call."""
    from tradingagents.config.providers import PROVIDER_REGISTRY
    from tradingagents.config.secrets import SecretsManager

    cfg = config or DEFAULT_CONFIG
    provider = cfg.get("llm_provider", "").lower()
    if not provider or provider == "ollama":
        return

    secrets = SecretsManager()
    api_key = secrets.resolve(provider)
    if not api_key:
        console.print("\n[yellow]LLM health check skipped: no API key found.[/yellow]")
        console.print("[dim]Set your API key and run 'tradingagents config health' again.[/dim]")
        return

    entry = PROVIDER_REGISTRY.get(provider, {})
    label = entry.get("label", provider.title())
    console.print(f"\n[bold]LLM connectivity check ({label})...[/bold]")

    try:
        from tradingagents.llm_clients import create_llm_client

        quick_model = cfg.get("quick_think_llm", "")
        client = create_llm_client(
            provider=provider,
            model=quick_model,
            base_url=cfg.get("backend_url"),
            api_key=api_key,
            max_tokens=5,
        )
        llm = client.get_llm()
        # Minimal smoke test: just invoke with a trivial prompt
        llm.invoke("Hi")
        console.print(f"[green]  {label}: healthy[/green]")
    except Exception as exc:
        msg = str(exc)[:120]
        console.print(f"[red]  {label}: {msg}[/red]")


@config_app.command("setup")
def config_setup() -> None:
    """Show a first-run setup summary (journal path, disabled vendors, routing).

    This is a read-only quick check — it does not create files, modify the
    config, or call any provider live. Useful as the first command after
    install to confirm where the journal will live and which vendors are
    enabled by the active configuration.
    """
    db_path = resolve_journal_db_path(DEFAULT_CONFIG)
    journal_enabled = bool(DEFAULT_CONFIG.get("journal", {}).get("enabled", True))
    snapshot = provider_health_snapshot(DEFAULT_CONFIG)
    disabled = snapshot.get("disabled_data_vendors") or []

    summary_lines = [
        f"Journal path: {db_path}",
        f"Journal enabled: {'yes' if journal_enabled else 'no'}",
        "",
        f"Disabled data vendors: {', '.join(disabled) if disabled else 'none'}",
    ]

    routing_lines: list[str] = []
    for category, details in (snapshot.get("categories") or {}).items():
        enabled = details.get("enabled") or []
        cat_disabled = details.get("disabled") or []
        suffix = f" (disabled: {', '.join(cat_disabled)})" if cat_disabled else ""
        routing_lines.append(
            f"- {category}: {', '.join(enabled) if enabled else 'none'}{suffix}"
        )
    if routing_lines:
        summary_lines.extend(["", "Active provider routing:"])
        summary_lines.extend(routing_lines)

    console.print(
        Panel(
            "\n".join(summary_lines),
            title="TradingAgents Setup Summary",
            border_style="cyan",
        )
    )
    console.print(
        Panel(
            "- tradingagents research run\n"
            "- tradingagents dashboard\n"
            "- tradingagents config health",
            title="Next Useful Commands",
            border_style="blue",
        )
    )


@config_app.command("validate")
def config_validate(
    profile_name: str = typer.Option(
        None, "--profile", "-p", help="Validate a specific profile.",
    ),
    fail_fast: bool = typer.Option(
        True, "--fail-fast/--warn", help="Fail on first error (default) or collect warnings.",
    ),
):
    """Validate the effective configuration (defaults + overrides merged)."""
    from tradingagents.config.loader import ConfigLoader
    from tradingagents.exceptions import ConfigurationValidationError, LLMCredentialError

    loader = ConfigLoader()
    try:
        config = loader.load(profile=profile_name, fail_fast=fail_fast)
        console.print("[green]Configuration is valid.[/green]")

        # Summary
        console.print(f"  LLM Provider: [cyan]{config.get('llm_provider')}[/cyan]")
        console.print(f"  Deep thinker: [cyan]{config.get('deep_think_llm')}[/cyan]")
        console.print(f"  Quick thinker: [cyan]{config.get('quick_think_llm')}[/cyan]")
        console.print(f"  Asset class: [cyan]{config.get('asset_class')}[/cyan]")
        fb = config.get("llm_fallback", {})
        if fb.get("enabled"):
            console.print(
                f"  LLM fallback: [green]enabled[/green] "
                f"({' → '.join(fb.get('fallback_providers', []))})"
            )
        else:
            console.print("  LLM fallback: [dim]disabled[/dim]")

        secrets_cfg = config.get("secrets", {})
        console.print(f"  Secrets source: [cyan]{secrets_cfg.get('source', 'env')}[/cyan]")

    except (ConfigurationValidationError, LLMCredentialError, ConfigurationError) as exc:
        console.print(f"[red]Configuration validation failed:[/red]\n{exc}")
        raise typer.Exit(code=1)


@config_app.command("init")
def config_init():
    """Interactively create config/local.toml with your custom settings.

    This walks through the most common settings and writes a local config
    file that overrides the defaults without modifying the project files.
    """
    from pathlib import Path
    from tradingagents.config.loader import load_config_file
    from tradingagents.config.providers import PROVIDER_REGISTRY

    local_path = Path.cwd() / "config" / "local.toml"
    if local_path.exists():
        overwrite = typer.confirm(
            "config/local.toml already exists. Overwrite?"
        )
        if not overwrite:
            console.print("[dim]Cancelled.[/dim]")
            raise typer.Exit()

    overrides: dict = {}

    # LLM provider
    provider_choices = [
        f"{key} ({entry['label']})" for key, entry in PROVIDER_REGISTRY.items()
    ]
    console.print("\n[bold]LLM Provider[/bold]")
    console.print("Available: " + ", ".join(provider_choices))
    llm_provider = typer.prompt("Primary LLM provider", default="deepseek")
    if llm_provider.lower() not in PROVIDER_REGISTRY:
        console.print(f"[yellow]Warning: '{llm_provider}' is not a known provider.[/yellow]")
    else:
        overrides["llm_provider"] = llm_provider.lower()

    # Deep thinker model
    deep_model = typer.prompt("Deep-thinking model", default="")
    if deep_model:
        overrides["deep_think_llm"] = deep_model

    # Quick thinker model
    quick_model = typer.prompt("Quick-thinking model", default="")
    if quick_model:
        overrides["quick_think_llm"] = quick_model

    # Fallback providers
    console.print("\n[bold]LLM Fallback[/bold]")
    enable_fb = typer.confirm("Enable provider fallback on failure?", default=True)
    if enable_fb:
        fb_str = typer.prompt(
            "Fallback providers (comma-separated)", default="openrouter,openai"
        )
        fb_list = [p.strip().lower() for p in fb_str.split(",") if p.strip()]
        if fb_list:
            overrides.setdefault("llm_fallback", {})["enabled"] = True
            overrides.setdefault("llm_fallback", {})["fallback_providers"] = fb_list
    else:
        overrides.setdefault("llm_fallback", {})["enabled"] = False

    # Output language
    output_lang = typer.prompt("Output language", default="English")
    if output_lang.lower() != "english":
        overrides["output_language"] = output_lang

    # Write the file
    local_path.parent.mkdir(parents=True, exist_ok=True)
    content_lines = []
    _write_toml_section(content_lines, overrides, 0)
    local_path.write_text("\n".join(content_lines) + "\n", encoding="utf-8")
    console.print(f"\n[green]Config written to[/green] {local_path}")
    console.print("[dim]Run 'tradingagents config validate' to check your settings.[/dim]")


def _write_toml_section(lines: list[str], data: dict, indent: int) -> None:
    """Write a dict as TOML lines (simple, no array-of-tables needed)."""
    prefix = "  " * indent
    for key, value in data.items():
        if isinstance(value, dict):
            if indent == 0:
                lines.append(f"\n[{key}]")
            else:
                lines.append(f"{prefix}[{key}]")
            _write_toml_section(lines, value, indent + 1)
        elif isinstance(value, list):
            lines.append(f"{prefix}{key} = [")
            for item in value:
                lines.append(f'{prefix}  "{item}",')
            lines.append(f"{prefix}]")
        elif isinstance(value, bool):
            lines.append(f"{prefix}{key} = {str(value).lower()}")
        elif isinstance(value, (int, float)):
            lines.append(f"{prefix}{key} = {value}")
        elif isinstance(value, str):
            lines.append(f'{prefix}{key} = "{value}"')
        else:
            lines.append(f'{prefix}{key} = "{value}"')


@config_app.command("effective")
def config_effective(
    profile_name: str = typer.Option(
        None, "--profile", "-p", help="Include a specific profile.",
    ),
):
    """Show the fully resolved effective configuration (all layers merged).

    Unlike ``config show --full`` which shows only profile+defaults, this
    includes env vars, local.toml, and CLI overrides in the merged result.
    """
    from tradingagents.config.loader import ConfigLoader

    loader = ConfigLoader()
    config = loader.load(profile=profile_name, fail_fast=False)

    # Redact any secret-like values for safe display
    display = _redact_secrets_in_config(config)

    yaml_str = yaml.safe_dump(display, default_flow_style=False,
                              sort_keys=False, allow_unicode=True)
    console.print(Panel(
        Syntax(yaml_str, "yaml", theme="monokai", line_numbers=False),
        title="Effective Configuration",
        border_style="cyan",
    ))


def _redact_secrets_in_config(config: dict) -> dict:
    """Return a copy of config with API-key-like values redacted for display."""
    from copy import deepcopy
    result = deepcopy(config)
    _secret_keywords = ("api_key", "token", "secret", "password", "key", "credential")
    for key in list(result.keys()):
        val = result[key]
        if isinstance(val, str) and any(kw in key.lower() for kw in _secret_keywords):
            if len(val) > 8:
                result[key] = val[:4] + "..." + val[-4:]
    return result


def register_config(parent_app: typer.Typer) -> None:
    """Mount the config command group on the main CLI app."""
    parent_app.add_typer(config_app, name="config")
