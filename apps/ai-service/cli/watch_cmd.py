"""Watchlist CLI for thesis monitoring."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.domain import WatchlistItem
from tradingagents.services import WatchlistService
from tradingagents.services.watchlist_service import BriefAlertRow, BriefThesisRow
from cli.json_emit import (
    ensure_single_output_mode,
    print_json_stdout,
    print_plain_stdout,
    to_jsonable,
)

console = Console()
app = typer.Typer(help="Manage thesis watchlists and local research alerts.")


def _service() -> WatchlistService:
    return WatchlistService()


@app.command(name="add-symbol")
def add_symbol(
    symbol: str = typer.Argument(..., help="Trading pair to watch, e.g. BTC/USDT"),
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
) -> None:
    """Add a symbol to a watchlist."""
    item = _service().add_symbol(symbol, watchlist_name=watchlist)
    console.print(
        Panel(
            f"Added [cyan]{item.symbol}[/cyan] to watchlist [bold]{watchlist}[/bold].\n"
            f"Item id: [dim]{item.id}[/dim]",
            title="Watchlist",
            border_style="green",
        )
    )


@app.command(name="add-thesis")
def add_thesis(
    thesis_id: str = typer.Argument(..., help="Saved thesis id to monitor"),
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
) -> None:
    """Add a saved thesis to a watchlist."""
    try:
        item = _service().add_thesis(thesis_id, watchlist_name=watchlist)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    console.print(
        Panel(
            f"Watching thesis [cyan]{item.thesis_id}[/cyan] for [bold]{item.symbol}[/bold].\n"
            f"Item id: [dim]{item.id}[/dim]",
            title="Thesis Watch",
            border_style="green",
        )
    )


@app.command(name="list")
def list_items(
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
    all_items: bool = typer.Option(False, "--all", help="Include disabled items"),
    limit: int = typer.Option(100, "--limit", min=1, help="Maximum items to show"),
    json_out: bool = typer.Option(False, "--json", help="Emit items as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit items as plain text."),
) -> None:
    """List watchlist items."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    items = _service().list_items(
        watchlist_name=watchlist,
        enabled_only=not all_items,
        limit=limit,
    )
    if json_out:
        print_json_stdout({"watchlist": watchlist, "items": items})
        return
    if plain:
        lines = ["id\titem_type\tsymbol\tthesis_id\tenabled"]
        lines.extend(
            "\t".join(
                [
                    item.id or "",
                    item.item_type.value,
                    item.symbol or "",
                    item.thesis_id or "",
                    "yes" if item.enabled else "no",
                ]
            )
            for item in items
        )
        print_plain_stdout(lines)
        return
    table = Table(title=f"Watchlist: {watchlist}")
    table.add_column("Item ID", style="dim")
    table.add_column("Type", style="cyan")
    table.add_column("Symbol")
    table.add_column("Thesis")
    table.add_column("Enabled")
    for item in items:
        table.add_row(
            item.id or "",
            item.item_type.value,
            item.symbol or "-",
            item.thesis_id or "-",
            "yes" if item.enabled else "no",
        )
    console.print(table)


@app.command(name="remove")
def remove_item(
    item_id: str = typer.Argument(..., help="Watchlist item id to disable"),
) -> None:
    """Disable a watchlist item."""
    item = _service().remove_item(item_id)
    if not item:
        raise typer.BadParameter(f"Watchlist item not found: {item_id}")
    console.print(f"[yellow]Disabled watchlist item:[/yellow] {item.id}")


@app.command(name="alerts")
def alerts(
    symbol: str | None = typer.Option(None, "--symbol", help="Filter by symbol"),
    thesis_id: str | None = typer.Option(
        None, "--thesis-id", help="Filter by thesis id"
    ),
    unread_only: bool = typer.Option(False, "--unread", help="Show only unread alerts"),
    limit: int = typer.Option(50, "--limit", min=1, help="Maximum alerts to show"),
    json_out: bool = typer.Option(False, "--json", help="Emit alerts as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit alerts as plain text."),
) -> None:
    """List stored research alerts."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    rows = _service().list_alerts(
        symbol=symbol,
        thesis_id=thesis_id,
        unread_only=unread_only,
        limit=limit,
    )
    if json_out:
        print_json_stdout({"alerts": rows})
        return
    if plain:
        lines = ["id\tcreated_at\talert_type\tsymbol\tthesis_id\tmessage"]
        lines.extend(
            "\t".join(
                [
                    alert.id or "",
                    alert.created_at.isoformat(),
                    alert.alert_type.value,
                    alert.symbol,
                    alert.thesis_id or "",
                    alert.message,
                ]
            )
            for alert in rows
        )
        print_plain_stdout(lines)
        return
    table = Table(title="Research Alerts")
    table.add_column("Created")
    table.add_column("Type", style="cyan")
    table.add_column("Symbol")
    table.add_column("Thesis")
    table.add_column("Message")
    for alert in rows:
        table.add_row(
            alert.created_at.isoformat(),
            alert.alert_type.value,
            alert.symbol,
            alert.thesis_id or "-",
            alert.message,
        )
    console.print(table)


@app.command(name="brief")
def brief(
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
    alerts_limit: int = typer.Option(
        20, "--alerts-limit", min=1, help="Maximum alerts to show"
    ),
    unread_only: bool = typer.Option(False, "--unread", help="Show only unread alerts"),
    evaluate_snapshots: bool = typer.Option(
        False,
        "--evaluate-snapshots",
        help="Evaluate scenario status using only the last persisted market snapshot.",
    ),
    json_out: bool = typer.Option(False, "--json", help="Emit brief as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit brief as plain text."),
) -> None:
    """Show a persisted-data brief for active watchlist theses."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    summary = _service().build_brief(
        watchlist_name=watchlist,
        alerts_limit=alerts_limit,
        unread_only=unread_only,
        evaluate_snapshots=evaluate_snapshots,
    )
    if json_out:
        print_json_stdout({"brief": to_jsonable(summary)})
        return
    if plain:
        payload = to_jsonable(summary)
        lines = [
            f"watchlist_name: {payload['watchlist_name']}",
            f"item_count: {payload['item_count']}",
            f"thesis_count: {payload['thesis_count']}",
            f"scenario_count: {len(payload['scenarios'])}",
            f"alert_count: {len(payload['alerts'])}",
            f"evaluated_from_snapshots: {payload['evaluated_from_snapshots']}",
        ]
        print_plain_stdout(lines)
        return
    console.print(
        Panel(
            f"Watchlist: [bold]{summary.watchlist_name}[/bold]\n"
            f"Items: [bold]{summary.item_count}[/bold] | "
            f"Theses: [bold cyan]{summary.thesis_count}[/bold cyan] | "
            f"Scenarios: [bold]{len(summary.scenarios)}[/bold] | "
            f"Recent alerts: [bold]{len(summary.alerts)}[/bold]\n"
            f"Snapshot evaluation: [yellow]{'enabled' if summary.evaluated_from_snapshots else 'disabled'}[/yellow]",
            title="Watchlist Brief",
            border_style="cyan",
        )
    )
    if summary.item_count == 0:
        console.print(
            Panel(
                "No active watchlist items yet.\n\n"
                "Start with:\n"
                "- tradingagents watchlist add-symbol BTC/USDT\n"
                "- tradingagents thesis list\n"
                "- tradingagents watchlist add-thesis <thesis_id>",
                title="Watchlist Empty State",
                border_style="yellow",
            )
        )
        return
    console.print(
        "[dim]Brief is read-only. Use `tradingagents watchlist check` to create alerts.[/dim]"
    )
    _print_symbol_only_items(summary.symbol_only_items)
    _print_brief_theses(summary.theses)
    _print_brief_scenarios(summary.scenarios, evaluate_snapshots=evaluate_snapshots)
    _print_scenario_activation_history(summary.alerts)
    _print_brief_alerts(summary.alerts)
    _print_latest_snapshot_digest(summary.theses)
    for missing in summary.missing_items:
        console.print(f"[yellow]Missing item:[/yellow] {missing}")
    console.print(
        Panel(
            "- tradingagents watchlist check\n"
            "- tradingagents watchlist alerts\n"
            "- tradingagents thesis list",
            title="Next Useful Commands",
            border_style="blue",
        )
    )


@app.command(name="check")
def check(
    watchlist: str = typer.Option(
        "default", "--watchlist", "-w", help="Watchlist name"
    ),
    price: list[str] | None = typer.Option(
        None,
        "--price",
        help="Current price override, e.g. --price BTC/USDT=103500",
    ),
) -> None:
    """Evaluate active thesis watches once and persist triggered alerts."""
    current_prices = _parse_price_overrides(price or [])
    result = _service().check_once(
        watchlist_name=watchlist, current_prices=current_prices
    )
    console.print(
        Panel(
            f"Checked items: [bold]{result.checked_items}[/bold]\n"
            f"New alerts: [bold cyan]{len(result.alerts_created)}[/bold cyan]\n"
            f"Skipped: [yellow]{len(result.skipped_items)}[/yellow]",
            title="Watchlist Check",
            border_style="cyan",
        )
    )
    for alert in result.alerts_created:
        console.print(f"[cyan]{alert.alert_type.value}[/cyan] {alert.message}")
    for skipped in result.skipped_items:
        console.print(f"[dim]Skipped {skipped}[/dim]")


def _print_latest_snapshot_digest(theses: list[BriefThesisRow]) -> None:
    picked: dict[str, BriefThesisRow] = {}
    for row in theses:
        if not row.symbol or row.last_snapshot_at is None:
            continue
        prev = picked.get(row.symbol)
        if prev is None:
            picked[row.symbol] = row
        else:
            prev_ts = prev.last_snapshot_at
            row_ts = row.last_snapshot_at
            if prev_ts is None or (row_ts is not None and row_ts > prev_ts):
                picked[row.symbol] = row

    if not picked:
        return

    table = Table(title="Latest Persisted Snapshots (symbols on this brief)")
    table.add_column("Symbol", style="cyan")
    table.add_column("Price")
    table.add_column("Source")
    table.add_column("Captured")
    for sym in sorted(picked.keys()):
        row = picked[sym]
        price_txt = (
            f"{row.last_price:g}" if isinstance(row.last_price, (float, int)) else "-"
        )
        src = row.last_snapshot_source or "-"
        cap = row.last_snapshot_at.isoformat() if row.last_snapshot_at else "-"
        table.add_row(sym, price_txt, src, cap)
    console.print(table)


def _print_scenario_activation_history(alerts: list[BriefAlertRow]) -> None:
    activated = sorted(
        (a for a in alerts if a.alert_type == "scenario_activated"),
        key=lambda a: a.created_at,
        reverse=True,
    )
    if not activated:
        return

    table = Table(title="Scenario activation history (recent brief window)")
    table.add_column("Created")
    table.add_column("Symbol", style="cyan")
    table.add_column("Thesis", style="dim")
    table.add_column("Message")
    for alert in activated[:15]:
        table.add_row(
            alert.created_at.isoformat(),
            alert.symbol,
            alert.thesis_id or "-",
            _truncate(alert.message, 140),
        )
    console.print(table)


def _parse_price_overrides(values: list[str]) -> dict[str, float]:
    prices: dict[str, float] = {}
    for value in values:
        if "=" not in value:
            raise typer.BadParameter(f"Price override must use SYMBOL=PRICE: {value}")
        symbol, raw_price = value.split("=", 1)
        try:
            prices[symbol] = float(raw_price.replace(",", ""))
        except ValueError as exc:
            raise typer.BadParameter(f"Invalid price override: {value}") from exc
    return prices


def _print_symbol_only_items(items: list[WatchlistItem]) -> None:
    if not items:
        return
    console.print(
        "[dim]Symbol-only watches:[/dim] "
        + ", ".join(item.symbol or "-" for item in items)
    )
    table = Table(title="Symbol-only Watches")
    table.add_column("Item ID", style="dim")
    table.add_column("Symbol", style="cyan")
    table.add_column("Note")
    for item in items:
        table.add_row(
            item.id or "",
            item.symbol or "-",
            "watch-only; add a thesis for monitoring rules",
        )
    console.print(table)


def _print_brief_theses(theses) -> None:
    if theses:
        console.print(
            "[dim]Active thesis symbols:[/dim] "
            + ", ".join(thesis.symbol for thesis in theses)
        )
    table = Table(title="Active Theses")
    table.add_column("Thesis", style="dim")
    table.add_column("Symbol", style="cyan")
    table.add_column("Direction")
    table.add_column("Setup")
    table.add_column("Confidence")
    table.add_column("Last Snapshot")
    table.add_column("Invalidation")
    table.add_column("Targets")
    for thesis in theses:
        confidence = (
            f"{thesis.confidence:.0%}" if thesis.confidence is not None else "-"
        )
        snapshot = "-"
        if thesis.last_price is not None:
            when = (
                thesis.last_snapshot_at.isoformat()
                if thesis.last_snapshot_at
                else "unknown time"
            )
            source = thesis.last_snapshot_source or "unknown source"
            snapshot = f"{thesis.last_price:g} ({source}, {when})"
        table.add_row(
            thesis.thesis_id,
            thesis.symbol,
            thesis.direction,
            thesis.setup_type,
            confidence,
            snapshot,
            thesis.invalidation_level or "-",
            ", ".join(thesis.target_zones) if thesis.target_zones else "-",
        )
    console.print(table)


def _print_brief_scenarios(scenarios, *, evaluate_snapshots: bool) -> None:
    table = Table(title="Saved Scenarios")
    table.add_column("Scenario", style="dim")
    table.add_column("Symbol", style="cyan")
    table.add_column("Band")
    table.add_column("Activated")
    table.add_column("Snapshot Status")
    table.add_column("Condition")
    table.add_column("Action")
    for scenario in scenarios:
        snapshot_status = "-"
        if evaluate_snapshots:
            snapshot_status = "active" if scenario.snapshot_active else "not active"
            if scenario.snapshot_reason:
                snapshot_status = f"{snapshot_status}: {scenario.snapshot_reason}"
        table.add_row(
            scenario.scenario_id or "-",
            scenario.symbol,
            scenario.probability_band,
            "yes" if scenario.activated else "no",
            snapshot_status,
            _truncate(scenario.condition, 80),
            scenario.suggested_user_action,
        )
    console.print(table)


def _print_brief_alerts(alerts) -> None:
    table = Table(title="Recent Watchlist Alerts")
    table.add_column("Created")
    table.add_column("Type", style="cyan")
    table.add_column("Symbol")
    table.add_column("Thesis")
    table.add_column("Read")
    table.add_column("Message")
    for alert in alerts:
        table.add_row(
            alert.created_at.isoformat(),
            alert.alert_type,
            alert.symbol,
            alert.thesis_id or "-",
            "yes" if alert.read_at else "no",
            _truncate(alert.message, 100),
        )
    console.print(table)


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _render_item(item: WatchlistItem) -> str:
    return item.thesis_id or item.symbol or item.setup_type or item.id or "-"


def register_watch(parent_app: typer.Typer) -> None:
    """Mount the watch command group on the main CLI app."""
    parent_app.add_typer(app, name="watchlist")


if __name__ == "__main__":
    app()
