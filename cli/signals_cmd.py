"""Signal provenance explorer commands."""

from __future__ import annotations

from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services import JournalService

from cli.json_emit import print_json_stdout

console = Console()
signals_app = typer.Typer(help="Inspect saved signal provenance.")


def _service() -> JournalService:
    return JournalService(DEFAULT_CONFIG)


@signals_app.command("list")
def signals_list(
    symbol: Optional[str] = typer.Argument(None, help="Optional symbol filter, e.g. BTC/USDT."),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="Emit signals as JSON."),
):
    """List recent saved signals."""
    signals = _service().list_signals(symbol=symbol, limit=limit)
    if not signals:
        if json_out:
            print_json_stdout([])
        else:
            console.print("[yellow]No signals saved yet.[/yellow]")
        return

    if json_out:
        print_json_stdout({"signals": [s.model_dump(mode="json") for s in signals]})
        return

    table = Table(title="Saved Signals")
    table.add_column("ID", style="cyan", overflow="fold")
    table.add_column("Symbol")
    table.add_column("Type")
    table.add_column("Direction")
    table.add_column("Confidence")
    table.add_column("Freshness")
    table.add_column("Observed")
    table.add_column("Source TS")

    for signal in signals:
        confidence = f"{signal.confidence:.0%}" if signal.confidence is not None else "N/A"
        source_ts = (
            signal.provenance.source_timestamp.isoformat()
            if signal.provenance.source_timestamp
            else "N/A"
        )
        table.add_row(
            signal.id or "",
            signal.symbol,
            signal.signal_type,
            signal.direction.value,
            confidence,
            signal.provenance.freshness.value,
            signal.observed_at.isoformat(),
            source_ts,
        )
    console.print(table)


@signals_app.command("show")
def signals_show(
    signal_id: str = typer.Argument(..., help="Signal id."),
    json_out: bool = typer.Option(False, "--json", help="Emit signal record as JSON."),
):
    """Show full saved signal provenance."""
    signal = _service().get_signal(signal_id)
    if not signal:
        console.print(f"[red]Signal not found:[/red] {signal_id}")
        raise typer.Exit(1)

    if json_out:
        print_json_stdout({"signal": signal.model_dump(mode="json")})
        return

    lines = [
        f"ID: {signal.id}",
        f"Symbol: {signal.symbol}",
        f"Type: {signal.signal_type}",
        f"Direction: {signal.direction.value}",
        f"Strength: {signal.strength if signal.strength is not None else 'N/A'}",
        f"Confidence: {signal.confidence if signal.confidence is not None else 'N/A'}",
        f"Supporting: {signal.supporting}",
        "",
        "Provenance:",
        f"- Source: {signal.provenance.source}",
        f"- Source Timestamp: {signal.provenance.source_timestamp.isoformat() if signal.provenance.source_timestamp else 'N/A'}",
        f"- Observed At: {signal.provenance.observed_at.isoformat()}",
        f"- Freshness: {signal.provenance.freshness.value}",
        f"- Freshness Seconds: {signal.provenance.freshness_seconds if signal.provenance.freshness_seconds is not None else 'N/A'}",
        "",
        "Evidence:",
    ]
    if signal.evidence:
        lines.extend(f"- {key}: {value}" for key, value in signal.evidence.items())
    else:
        lines.append("- N/A")
    if signal.summary:
        lines.extend(["", "Summary:", signal.summary])

    console.print(Panel("\n".join(lines), title="Signal Provenance", border_style="cyan"))


def register_signals(parent_app: typer.Typer) -> None:
    """Mount signal commands on the main CLI app."""
    parent_app.add_typer(signals_app, name="signals")
