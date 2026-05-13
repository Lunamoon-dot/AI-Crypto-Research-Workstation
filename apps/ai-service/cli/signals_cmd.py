"""Signal snapshot and provenance explorer commands."""

from __future__ import annotations

import json
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import ResearchRun, Signal, SignalSnapshot
from tradingagents.services import SignalService

from cli.json_emit import (
    ensure_single_output_mode,
    print_json_stdout,
    print_plain_stdout,
)

console = Console()
signals_app = typer.Typer(help="Inspect saved signal snapshots and provenance.")

RELIABILITY_MIN_SAMPLE = 20
LANE_ORDER = ("quant_bias", "spot", "perp", "unknown")


def _service() -> SignalService:
    return SignalService(DEFAULT_CONFIG)


def _signal_payload(signal: Signal) -> dict:
    return signal.model_dump(mode="json")


def _snapshot_payload(snapshot: SignalSnapshot) -> dict:
    payload = snapshot.model_dump(mode="json")
    payload["quant_bias_signal_id"] = payload.pop("composite_signal_id", None)
    return payload


def _bundle_payload(
    *,
    run: ResearchRun | None,
    snapshot: SignalSnapshot,
    signals: list[Signal],
) -> dict:
    return {
        "run": run.model_dump(mode="json") if run else None,
        "signal_snapshot": _snapshot_payload(snapshot),
        "signals": [_signal_payload(signal) for signal in signals],
    }


def _lane(signal: Signal) -> str:
    lane = getattr(signal.evidence_lane, "value", None) or "unknown"
    if lane == "unknown":
        lane = str(signal.evidence.get("evidence_lane") or "unknown")
    return lane


def _category(signal: Signal) -> str:
    category = signal.evidence_category or "unknown"
    if category == "unknown":
        category = str(signal.evidence.get("evidence_category") or "unknown")
    return category


def _bias(signal: Signal) -> str:
    if signal.direction.value in {"bullish", "bearish", "neutral", "mixed"}:
        return signal.direction.value
    return str(signal.evidence.get("quant_bias") or "unknown")


def _fmt_pct(value: float | None) -> str:
    return f"{value:.0%}" if value is not None else "N/A"


def _format_reliability(signal: Signal) -> str:
    reliability = signal.provenance.historical_reliability
    sample_size = signal.provenance.sample_size
    if reliability is None:
        return "unreviewed"
    n = sample_size if sample_size is not None else 0
    if n < RELIABILITY_MIN_SAMPLE:
        return f"calibrating (n={n})"
    return f"{reliability:.0%} (n={n})"


def _signals_by_lane(signals: list[Signal]) -> dict[str, list[Signal]]:
    grouped: dict[str, list[Signal]] = {lane: [] for lane in LANE_ORDER}
    for signal in signals:
        grouped.setdefault(_lane(signal), []).append(signal)
    return grouped


def _plain_snapshot_lines(
    *,
    run: ResearchRun | None,
    snapshot: SignalSnapshot,
    signals: list[Signal],
) -> list[str]:
    lines = [
        f"run_id: {snapshot.research_run_id}",
        f"snapshot_id: {snapshot.id or ''}",
        f"symbol: {snapshot.symbol}",
        f"captured_at: {snapshot.captured_at.isoformat()}",
        f"signal_count: {len(snapshot.signal_ids)}",
    ]
    if run:
        lines.append(f"run_status: {run.status.value}")
    lines.append("note: quant_bias is aggregate evidence, not execution guidance")

    grouped = _signals_by_lane(signals)
    for lane in LANE_ORDER:
        lane_signals = grouped.get(lane) or []
        if not lane_signals:
            continue
        lines.extend(["", f"{lane}:"])
        for signal in lane_signals:
            lines.append(
                "\t".join(
                    [
                        signal.id or "",
                        signal.signal_type,
                        _category(signal),
                        _bias(signal),
                        _fmt_pct(signal.confidence),
                        signal.provenance.freshness.value,
                        _format_reliability(signal),
                    ]
                )
            )
    return lines


def _print_snapshot(
    *,
    run: ResearchRun | None,
    snapshot: SignalSnapshot,
    signals: list[Signal],
) -> None:
    summary_lines = [
        f"Run: {snapshot.research_run_id}",
        f"Snapshot: {snapshot.id or 'N/A'}",
        f"Symbol: {snapshot.symbol}",
        f"Captured: {snapshot.captured_at.isoformat()}",
        f"Signals: {len(snapshot.signal_ids)}",
        f"Bullish / Bearish / Neutral: "
        f"{snapshot.bullish_count} / {snapshot.bearish_count} / "
        f"{snapshot.neutral_count}",
        "Quant bias is aggregate evidence, not execution guidance.",
    ]
    if run:
        summary_lines.insert(1, f"Run Status: {run.status.value}")
    console.print(
        Panel("\n".join(summary_lines), title="Signal Snapshot", border_style="cyan")
    )

    grouped = _signals_by_lane(signals)
    titles = {
        "quant_bias": "Quant Bias",
        "spot": "Spot Evidence Lane",
        "perp": "Perp Evidence Lane",
        "unknown": "Unclassified Evidence",
    }
    for lane in LANE_ORDER:
        lane_signals = grouped.get(lane) or []
        if not lane_signals:
            continue
        table = Table(title=titles.get(lane, lane))
        table.add_column("ID", style="cyan", overflow="fold")
        table.add_column("Type")
        table.add_column("Category")
        table.add_column("Bias")
        table.add_column("Confidence")
        table.add_column("Reliability")
        table.add_column("Freshness")
        for signal in lane_signals:
            table.add_row(
                signal.id or "",
                signal.signal_type,
                _category(signal),
                _bias(signal),
                _fmt_pct(signal.confidence),
                _format_reliability(signal),
                signal.provenance.freshness.value,
            )
        console.print(table)

    watch_lines = []
    for signal in signals[:8]:
        trigger = signal.watch_conditions.review_trigger
        if trigger:
            watch_lines.append(f"- {signal.signal_type}: {trigger}")
    if watch_lines:
        console.print(
            Panel(
                "\n".join(watch_lines),
                title="Review Triggers",
                border_style="yellow",
            )
        )


def _emit_snapshot(
    *,
    run: ResearchRun | None,
    snapshot: SignalSnapshot,
    signals: list[Signal],
    json_out: bool,
    plain: bool,
) -> None:
    if json_out:
        print_json_stdout(_bundle_payload(run=run, snapshot=snapshot, signals=signals))
        return
    if plain:
        print_plain_stdout(
            _plain_snapshot_lines(run=run, snapshot=snapshot, signals=signals)
        )
        return
    _print_snapshot(run=run, snapshot=snapshot, signals=signals)


@signals_app.command("latest")
def signals_latest(
    symbol: str = typer.Argument(..., help="Symbol filter, e.g. ETH/USDT."),
    json_out: bool = typer.Option(False, "--json", help="Emit snapshot as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit snapshot as plain text."),
):
    """Show the latest signal snapshot for one symbol."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    run, snapshot, signals = _service().get_latest_snapshot(symbol)
    if not snapshot:
        console.print(f"[yellow]No signal snapshot saved for {symbol}.[/yellow]")
        raise typer.Exit(1)
    _emit_snapshot(
        run=run,
        snapshot=snapshot,
        signals=signals,
        json_out=json_out,
        plain=plain,
    )


@signals_app.command("snapshot")
def signals_snapshot(
    run_id: str = typer.Argument(..., help="Research run id."),
    json_out: bool = typer.Option(False, "--json", help="Emit snapshot as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit snapshot as plain text."),
):
    """Show the signal snapshot attached to one research run."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    run, snapshot, signals = _service().get_snapshot_for_run(run_id)
    if not run:
        console.print(f"[red]Research run not found:[/red] {run_id}")
        raise typer.Exit(1)
    if not snapshot:
        console.print(f"[yellow]No signal snapshot saved for run:[/yellow] {run_id}")
        raise typer.Exit(1)
    _emit_snapshot(
        run=run,
        snapshot=snapshot,
        signals=signals,
        json_out=json_out,
        plain=plain,
    )


@signals_app.command("list")
def signals_list(
    symbol: Optional[str] = typer.Argument(
        None, help="Optional symbol filter, e.g. BTC/USDT."
    ),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="Emit signals as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit signals as plain text."),
):
    """List recent saved signals across runs. Prefer latest/snapshot for review."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    signals = _service().list_signals(symbol=symbol, limit=limit)
    if not signals:
        if json_out:
            print_json_stdout([])
        elif plain:
            print_plain_stdout([])
        else:
            console.print("[yellow]No signals saved yet.[/yellow]")
        return

    if json_out:
        print_json_stdout({"signals": [_signal_payload(s) for s in signals]})
        return
    if plain:
        lines = [
            "id\tsymbol\tlane\tcategory\tsignal_type\tbias\tconfidence\tobserved_at"
        ]
        lines.extend(
            "\t".join(
                [
                    signal.id or "",
                    signal.symbol,
                    _lane(signal),
                    _category(signal),
                    signal.signal_type,
                    _bias(signal),
                    "" if signal.confidence is None else f"{signal.confidence:.4f}",
                    signal.observed_at.isoformat(),
                ]
            )
            for signal in signals
        )
        print_plain_stdout(lines)
        return

    table = Table(title="Saved Signals (cross-run)")
    table.add_column("ID", style="cyan", overflow="fold")
    table.add_column("Symbol")
    table.add_column("Lane")
    table.add_column("Category")
    table.add_column("Type")
    table.add_column("Bias")
    table.add_column("Confidence")
    table.add_column("Reliability")
    table.add_column("Freshness")
    table.add_column("Observed")

    for signal in signals:
        table.add_row(
            signal.id or "",
            signal.symbol,
            _lane(signal),
            _category(signal),
            signal.signal_type,
            _bias(signal),
            _fmt_pct(signal.confidence),
            _format_reliability(signal),
            signal.provenance.freshness.value,
            signal.observed_at.isoformat(),
        )
    console.print(table)


@signals_app.command("explain")
def signals_explain(
    signal_id: str = typer.Argument(..., help="Signal id."),
    json_out: bool = typer.Option(False, "--json", help="Emit signal record as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit signal as plain text."),
):
    """Explain one saved signal with provenance and watch conditions."""
    ensure_single_output_mode(json_out=json_out, plain=plain)
    signal, run, snapshot = _service().explain_signal(signal_id)
    if not signal:
        console.print(f"[red]Signal not found:[/red] {signal_id}")
        raise typer.Exit(1)

    if json_out:
        print_json_stdout(
            {
                "signal": _signal_payload(signal),
                "run": run.model_dump(mode="json") if run else None,
                "signal_snapshot": (_snapshot_payload(snapshot) if snapshot else None),
            }
        )
        return
    if plain:
        payload = _signal_payload(signal)
        lines = []
        for key, value in payload.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            lines.append(f"{key}: {value}")
        print_plain_stdout(lines)
        return

    watch = signal.watch_conditions
    lines = [
        f"ID: {signal.id}",
        f"Run: {run.id if run else 'N/A'}",
        f"Snapshot: {snapshot.id if snapshot else 'N/A'}",
        f"Symbol: {signal.symbol}",
        f"Type: {signal.signal_type}",
        f"Lane: {_lane(signal)}",
        f"Category: {_category(signal)}",
        f"Bias: {_bias(signal)}",
        f"Strength: {signal.strength if signal.strength is not None else 'N/A'}",
        f"Confidence: {_fmt_pct(signal.confidence)}",
        f"Reliability: {_format_reliability(signal)}",
        f"Supporting: {signal.supporting}",
        "",
        "Watch Conditions:",
        f"- What changed: {watch.what_changed or 'N/A'}",
        f"- Invalidates: {watch.invalidation or 'N/A'}",
        f"- Review trigger: {watch.review_trigger or 'N/A'}",
        "",
        "Provenance:",
        f"- Source: {signal.provenance.source}",
        "- Source Timestamp: "
        + (
            signal.provenance.source_timestamp.isoformat()
            if signal.provenance.source_timestamp
            else "N/A"
        ),
        f"- Observed At: {signal.provenance.observed_at.isoformat()}",
        f"- Freshness: {signal.provenance.freshness.value}",
        "- Freshness Seconds: "
        + (
            str(signal.provenance.freshness_seconds)
            if signal.provenance.freshness_seconds is not None
            else "N/A"
        ),
        "",
        "Evidence:",
    ]
    if signal.evidence:
        lines.extend(
            f"- {key}: {json.dumps(value, ensure_ascii=False)}"
            for key, value in signal.evidence.items()
        )
    else:
        lines.append("- N/A")
    if signal.summary:
        lines.extend(["", "Summary:", signal.summary])

    console.print(Panel("\n".join(lines), title="Signal Explain", border_style="cyan"))


@signals_app.command("show")
def signals_show(
    signal_id: str = typer.Argument(..., help="Signal id."),
    json_out: bool = typer.Option(False, "--json", help="Emit signal record as JSON."),
    plain: bool = typer.Option(False, "--plain", help="Emit signal as plain text."),
):
    """Backward-compatible alias for ``signals explain``."""
    signals_explain(signal_id=signal_id, json_out=json_out, plain=plain)


def register_signals(parent_app: typer.Typer) -> None:
    """Mount signal commands on the main CLI app."""
    parent_app.add_typer(signals_app, name="signals")
