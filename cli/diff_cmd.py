"""Thesis and run diff logic — Phase excellence backlog.

Provides comparison functions and CLI commands for diff-ing two
trade theses or two research runs side-by-side.
"""

from __future__ import annotations

from typing import Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import ThesisDirection, TradeThesis
from tradingagents.services import JournalService

console = Console()
diff_app = typer.Typer(help="Diff two theses or research runs side-by-side.")


def _service():
    return JournalService(DEFAULT_CONFIG)


def diff_theses(
    thesis_a: TradeThesis,
    thesis_b: TradeThesis,
    *,
    id_a: str = "",
    id_b: str = "",
) -> None:
    """Print a side-by-side diff of two trade theses."""

    label_a = id_a[:12] or "thesis A"
    label_b = id_b[:12] or "thesis B"

    # --- Header ---
    console.print(
        Panel(
            f"Comparing theses for [bold]{thesis_a.symbol}[/bold]",
            title="Thesis Diff",
            border_style="cyan",
        )
    )

    # --- Direction ---
    _diff_row("Direction", _dir_label(thesis_a.direction), _dir_label(thesis_b.direction))

    # --- Confidence ---
    _diff_row(
        "Confidence",
        _fmt_conf(thesis_a.confidence),
        _fmt_conf(thesis_b.confidence),
    )

    # --- Stance summary ---
    _diff_row("Thesis text", thesis_a.thesis_text[:120], thesis_b.thesis_text[:120])

    # --- Invalidation level ---
    _diff_row(
        "Invalidation level",
        thesis_a.invalidation_level or "—",
        thesis_b.invalidation_level or "—",
    )

    # --- Signal IDs (supporting) ---
    sup_a = thesis_a.supporting_signal_ids or []
    sup_b = thesis_b.supporting_signal_ids or []
    _diff_list("Supporting signals", sup_a, sup_b, label_a, label_b)

    # --- Signal IDs (contradicting) ---
    con_a = thesis_a.contradicting_signal_ids or []
    con_b = thesis_b.contradicting_signal_ids or []
    _diff_list("Contradicting signals", con_a, con_b, label_a, label_b)

    # --- Evidence ---
    ev_a = thesis_a.evidence or {}
    ev_b = thesis_b.evidence or {}
    _diff_evidence(ev_a, ev_b, label_a, label_b)

    # --- Contradictions ---
    contr_a = thesis_a.contradictions or []
    contr_b = thesis_b.contradictions or []
    _diff_list("Contradictions", contr_a, contr_b, label_a, label_b)

    # --- Risk notes ---
    risk_a = thesis_a.risk_notes or []
    risk_b = thesis_b.risk_notes or []
    _diff_list("Risk notes", risk_a, risk_b, label_a, label_b)


def diff_runs(
    run_a: Any,
    run_b: Any,
    *,
    id_a: str = "",
    id_b: str = "",
    thesis_a: TradeThesis | None = None,
    thesis_b: TradeThesis | None = None,
) -> None:
    """Print a side-by-side diff of two research runs."""

    label_a = id_a[:12] or "run A"
    label_b = id_b[:12] or "run B"

    console.print(
        Panel(
            "Comparing research runs",
            title="Run Diff",
            border_style="cyan",
        )
    )

    # Basic run fields
    _diff_row("Symbol", getattr(run_a, "symbol", "—"), getattr(run_b, "symbol", "—"))
    _diff_row(
        "Started at",
        str(getattr(run_a, "started_at", "—")),
        str(getattr(run_b, "started_at", "—")),
    )
    _diff_row(
        "Completed at",
        str(getattr(run_a, "completed_at", "—") or "—"),
        str(getattr(run_b, "completed_at", "—") or "—"),
    )
    _diff_row(
        "Status",
        str(getattr(run_a, "status", "—")),
        str(getattr(run_b, "status", "—")),
    )
    _diff_row(
        "Thesis ID",
        getattr(run_a, "thesis_id", "—") or "—",
        getattr(run_b, "thesis_id", "—") or "—",
    )
    _diff_row(
        "Debate ID",
        getattr(run_a, "debate_id", "—") or "—",
        getattr(run_b, "debate_id", "—") or "—",
    )
    _diff_row(
        "Signal snapshot",
        getattr(run_a, "signal_snapshot_id", "—") or "—",
        getattr(run_b, "signal_snapshot_id", "—") or "—",
    )

    # Signal IDs
    sig_a = getattr(run_a, "signal_ids", []) or []
    sig_b = getattr(run_b, "signal_ids", []) or []
    _diff_list("Signal IDs", sig_a, sig_b, label_a, label_b)

    # If theses are provided, also diff them
    if thesis_a and thesis_b:
        console.print()
        diff_theses(thesis_a, thesis_b, id_a=id_a, id_b=id_b)
    elif thesis_a:
        console.print(f"\n[yellow]Only {label_a} has a thesis.[/yellow]")
    elif thesis_b:
        console.print(f"\n[yellow]Only {label_b} has a thesis.[/yellow]")


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _dir_label(d: ThesisDirection | None) -> str:
    if d is None:
        return "—"
    return d.value.upper()


def _fmt_conf(conf: float | None) -> str:
    if conf is None:
        return "—"
    return f"{conf:.0%}"


def _diff_row(field: str, val_a: str, val_b: str) -> None:
    table = Table(show_header=False, box=None, padding=(0, 1))
    table.add_column("Field", style="dim", width=18)
    table.add_column("A", style="cyan")
    table.add_column("B", style="magenta")
    table.add_row(field, val_a, val_b)
    console.print(table)


def _diff_list(
    field: str,
    items_a: list[str],
    items_b: list[str],
    label_a: str,
    label_b: str,
) -> None:
    set_a = set(items_a)
    set_b = set(items_b)
    common = sorted(set_a & set_b)
    only_a = sorted(set_a - set_b)
    only_b = sorted(set_b - set_a)

    if not items_a and not items_b:
        return

    lines: list[str] = []
    if common:
        lines.append(f"[dim]Common ({len(common)}):[/dim] {', '.join(common[:5])}")
        if len(common) > 5:
            lines.append(f"[dim]  ... and {len(common) - 5} more[/dim]")
    if only_a:
        lines.append(f"[cyan]Only {label_a} ({len(only_a)}):[/cyan] {', '.join(only_a[:5])}")
        if len(only_a) > 5:
            lines.append(f"[cyan]  ... and {len(only_a) - 5} more[/cyan]")
    if only_b:
        lines.append(f"[magenta]Only {label_b} ({len(only_b)}):[/magenta] {', '.join(only_b[:5])}")
        if len(only_b) > 5:
            lines.append(f"[magenta]  ... and {len(only_b) - 5} more[/magenta]")

    if lines:
        console.print(f"[bold]{field}[/bold]")
        for line in lines:
            console.print(f"  {line}")


def _diff_evidence(
    ev_a: dict,
    ev_b: dict,
    label_a: str,
    label_b: str,
) -> None:
    all_keys = set(ev_a.keys()) | set(ev_b.keys())
    if not all_keys:
        return

    console.print("[bold]Evidence[/bold]")
    for key in sorted(all_keys):
        va = ev_a.get(key)
        vb = ev_b.get(key)
        if va == vb:
            console.print(f"  [dim]{key}: same[/dim]")
            continue
        sa = _trunc(str(va), 60)
        sb = _trunc(str(vb), 60)
        if va is not None and vb is None:
            console.print(f"  [cyan]{key} ({label_a} only):[/cyan] {sa}")
        elif vb is not None and va is None:
            console.print(f"  [magenta]{key} ({label_b} only):[/magenta] {sb}")
        else:
            console.print(f"  [cyan]{key} (A):[/cyan] {sa}")
            console.print(f"  [magenta]{key} (B):[/magenta] {sb}")


def _trunc(s: str, n: int) -> str:
    s = s.replace("\n", " ")
    if len(s) <= n:
        return s
    return s[: n - 3] + "..."


# ------------------------------------------------------------------
# CLI commands
# ------------------------------------------------------------------


@diff_app.command("thesis")
def diff_thesis(
    thesis_id_1: str = typer.Argument(..., help="First thesis ID."),
    thesis_id_2: str = typer.Argument(..., help="Second thesis ID."),
) -> None:
    """Compare two trade theses — direction, evidence, signals, contradictions."""
    service = _service()

    thesis_a = service.get_thesis(thesis_id_1)
    if not thesis_a:
        console.print(f"[red]Thesis not found:[/red] {thesis_id_1}")
        raise typer.Exit(code=1)

    thesis_b = service.get_thesis(thesis_id_2)
    if not thesis_b:
        console.print(f"[red]Thesis not found:[/red] {thesis_id_2}")
        raise typer.Exit(code=1)

    if thesis_a.symbol != thesis_b.symbol:
        console.print(
            f"[yellow]Warning:[/yellow] Comparing theses for different symbols "
            f"({thesis_a.symbol} vs {thesis_b.symbol})"
        )

    diff_theses(thesis_a, thesis_b, id_a=thesis_id_1, id_b=thesis_id_2)


@diff_app.command("run")
def diff_run(
    run_id_1: str = typer.Argument(..., help="First research run ID."),
    run_id_2: str = typer.Argument(..., help="Second research run ID."),
) -> None:
    """Compare two research runs — signals, thesis, debate stance, analyst opinions."""
    service = _service()

    run_a = service.get_research_run(run_id_1)
    if not run_a:
        console.print(f"[red]Research run not found:[/red] {run_id_1}")
        raise typer.Exit(code=1)

    run_b = service.get_research_run(run_id_2)
    if not run_b:
        console.print(f"[red]Research run not found:[/red] {run_id_2}")
        raise typer.Exit(code=1)

    thesis_a = service.get_thesis(run_a.thesis_id) if run_a.thesis_id else None
    thesis_b = service.get_thesis(run_b.thesis_id) if run_b.thesis_id else None

    diff_runs(
        run_a,
        run_b,
        id_a=run_id_1,
        id_b=run_id_2,
        thesis_a=thesis_a,
        thesis_b=thesis_b,
    )


def register_diff(parent_app: typer.Typer) -> None:
    """Mount the diff command group on the main CLI app."""
    parent_app.add_typer(diff_app, name="diff")