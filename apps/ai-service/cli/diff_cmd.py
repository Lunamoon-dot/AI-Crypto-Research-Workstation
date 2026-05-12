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
from tradingagents.services import ThesisService

from cli.json_emit import print_json_stdout

console = Console()
diff_app = typer.Typer(help="Diff two theses or research runs side-by-side.")


def _service():
    return ThesisService(DEFAULT_CONFIG)


def _list_delta(items_a: list[str], items_b: list[str]) -> dict[str, Any]:
    set_a = set(items_a or [])
    set_b = set(items_b or [])
    common = sorted(set_a & set_b)
    only_a = sorted(set_a - set_b)
    only_b = sorted(set_b - set_a)
    return {
        "common": common,
        "only_a": only_a,
        "only_b": only_b,
        "changed": bool(only_a or only_b),
    }


def _severity_from_changed_fields(changed_fields: list[str]) -> str:
    major_fields = {
        "direction",
        "confidence",
        "invalidation_level",
        "supporting_signal_ids",
        "contradicting_signal_ids",
        "signal_ids",
        "status",
        "thesis",
    }
    if any(field in major_fields for field in changed_fields):
        return "major"
    if changed_fields:
        return "minor"
    return "none"


def _severity_reasons(changed_fields: list[str]) -> list[str]:
    major_reason_map = {
        "direction": "direction changed",
        "confidence": "confidence changed",
        "invalidation_level": "invalidation level changed",
        "supporting_signal_ids": "supporting signals changed",
        "contradicting_signal_ids": "contradicting signals changed",
        "signal_ids": "run signal set changed",
        "status": "run status changed",
        "thesis": "nested thesis diff has major changes",
    }
    reasons = [
        major_reason_map[field] for field in changed_fields if field in major_reason_map
    ]
    if reasons:
        return reasons
    if changed_fields:
        return [f"non-critical fields changed: {', '.join(changed_fields)}"]
    return ["no material changes"]


def build_thesis_diff_payload(
    thesis_a: TradeThesis,
    thesis_b: TradeThesis,
    *,
    id_a: str,
    id_b: str,
) -> dict[str, Any]:
    fields: dict[str, dict[str, Any]] = {}

    def add_simple(name: str, a: Any, b: Any) -> None:
        fields[name] = {"a": a, "b": b, "changed": a != b}

    add_simple("symbol", thesis_a.symbol, thesis_b.symbol)
    add_simple(
        "direction", _dir_label(thesis_a.direction), _dir_label(thesis_b.direction)
    )
    add_simple("confidence", thesis_a.confidence, thesis_b.confidence)
    add_simple("thesis_text", thesis_a.thesis_text, thesis_b.thesis_text)
    add_simple(
        "invalidation_level", thesis_a.invalidation_level, thesis_b.invalidation_level
    )
    fields["supporting_signal_ids"] = _list_delta(
        thesis_a.supporting_signal_ids, thesis_b.supporting_signal_ids
    )
    fields["contradicting_signal_ids"] = _list_delta(
        thesis_a.contradicting_signal_ids, thesis_b.contradicting_signal_ids
    )
    fields["contradictions"] = _list_delta(
        thesis_a.contradictions, thesis_b.contradictions
    )
    fields["risk_notes"] = _list_delta(thesis_a.risk_notes, thesis_b.risk_notes)

    ev_a = thesis_a.evidence or {}
    ev_b = thesis_b.evidence or {}
    all_keys = sorted(set(ev_a.keys()) | set(ev_b.keys()))
    evidence_changes: dict[str, dict[str, Any]] = {}
    for key in all_keys:
        a_val = ev_a.get(key)
        b_val = ev_b.get(key)
        evidence_changes[key] = {"a": a_val, "b": b_val, "changed": a_val != b_val}
    fields["evidence"] = {
        "keys": all_keys,
        "values": evidence_changes,
        "changed": any(v["changed"] for v in evidence_changes.values()),
    }

    changed_fields = [name for name, value in fields.items() if value.get("changed")]
    direction_flip = thesis_a.direction != thesis_b.direction
    severity = _severity_from_changed_fields(changed_fields)
    return {
        "kind": "thesis_diff",
        "id_a": id_a,
        "id_b": id_b,
        "cross_symbol": thesis_a.symbol != thesis_b.symbol,
        "direction_flip": direction_flip,
        "changed_fields": changed_fields,
        "changed_count": len(changed_fields),
        "change_severity": severity,
        "severity_reasons": _severity_reasons(changed_fields),
        "fields": fields,
    }


def build_run_diff_payload(
    run_a: Any,
    run_b: Any,
    *,
    id_a: str,
    id_b: str,
    thesis_a: TradeThesis | None = None,
    thesis_b: TradeThesis | None = None,
) -> dict[str, Any]:
    fields: dict[str, dict[str, Any]] = {}

    def add_simple(name: str, a: Any, b: Any) -> None:
        fields[name] = {"a": a, "b": b, "changed": a != b}

    add_simple("symbol", getattr(run_a, "symbol", None), getattr(run_b, "symbol", None))
    add_simple(
        "started_at",
        str(getattr(run_a, "started_at", None)),
        str(getattr(run_b, "started_at", None)),
    )
    add_simple(
        "completed_at",
        str(getattr(run_a, "completed_at", None)),
        str(getattr(run_b, "completed_at", None)),
    )
    add_simple(
        "status",
        str(getattr(run_a, "status", None)),
        str(getattr(run_b, "status", None)),
    )
    add_simple(
        "thesis_id",
        getattr(run_a, "thesis_id", None),
        getattr(run_b, "thesis_id", None),
    )
    add_simple(
        "debate_id",
        getattr(run_a, "debate_id", None),
        getattr(run_b, "debate_id", None),
    )
    add_simple(
        "signal_snapshot_id",
        getattr(run_a, "signal_snapshot_id", None),
        getattr(run_b, "signal_snapshot_id", None),
    )
    fields["signal_ids"] = _list_delta(
        list(getattr(run_a, "signal_ids", []) or []),
        list(getattr(run_b, "signal_ids", []) or []),
    )

    thesis_diff: dict[str, Any] | None = None
    if thesis_a and thesis_b:
        thesis_diff = build_thesis_diff_payload(
            thesis_a, thesis_b, id_a=id_a, id_b=id_b
        )

    changed_fields = [name for name, value in fields.items() if value.get("changed")]
    if thesis_diff and thesis_diff.get("changed_fields"):
        changed_fields.append("thesis")
    direction_flip = bool(thesis_diff and thesis_diff.get("direction_flip"))
    severity = _severity_from_changed_fields(changed_fields)

    return {
        "kind": "run_diff",
        "id_a": id_a,
        "id_b": id_b,
        "direction_flip": direction_flip,
        "changed_fields": changed_fields,
        "changed_count": len(changed_fields),
        "change_severity": severity,
        "severity_reasons": _severity_reasons(changed_fields),
        "fields": fields,
        "thesis_diff": thesis_diff,
    }


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

    console.print(
        Panel(
            f"Comparing theses for [bold]{thesis_a.symbol}[/bold]",
            title="Thesis Diff",
            border_style="cyan",
        )
    )

    _diff_row(
        "Direction", _dir_label(thesis_a.direction), _dir_label(thesis_b.direction)
    )
    _diff_row(
        "Confidence", _fmt_conf(thesis_a.confidence), _fmt_conf(thesis_b.confidence)
    )
    _diff_row("Thesis text", thesis_a.thesis_text[:120], thesis_b.thesis_text[:120])
    _diff_row(
        "Invalidation level",
        thesis_a.invalidation_level or "—",
        thesis_b.invalidation_level or "—",
    )
    _diff_list(
        "Supporting signals",
        thesis_a.supporting_signal_ids or [],
        thesis_b.supporting_signal_ids or [],
        label_a,
        label_b,
    )
    _diff_list(
        "Contradicting signals",
        thesis_a.contradicting_signal_ids or [],
        thesis_b.contradicting_signal_ids or [],
        label_a,
        label_b,
    )
    _diff_evidence(thesis_a.evidence or {}, thesis_b.evidence or {}, label_a, label_b)
    _diff_list(
        "Contradictions",
        thesis_a.contradictions or [],
        thesis_b.contradictions or [],
        label_a,
        label_b,
    )
    _diff_list(
        "Risk notes",
        thesis_a.risk_notes or [],
        thesis_b.risk_notes or [],
        label_a,
        label_b,
    )


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
        "Status", str(getattr(run_a, "status", "—")), str(getattr(run_b, "status", "—"))
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

    sig_a = getattr(run_a, "signal_ids", []) or []
    sig_b = getattr(run_b, "signal_ids", []) or []
    _diff_list("Signal IDs", sig_a, sig_b, label_a, label_b)

    if thesis_a and thesis_b:
        console.print()
        diff_theses(thesis_a, thesis_b, id_a=id_a, id_b=id_b)
    elif thesis_a:
        console.print(f"\n[yellow]Only {label_a} has a thesis.[/yellow]")
    elif thesis_b:
        console.print(f"\n[yellow]Only {label_b} has a thesis.[/yellow]")


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
    delta = _list_delta(items_a, items_b)
    common = delta["common"]
    only_a = delta["only_a"]
    only_b = delta["only_b"]

    if not items_a and not items_b:
        return

    lines: list[str] = []
    if common:
        lines.append(f"[dim]Common ({len(common)}):[/dim] {', '.join(common[:5])}")
        if len(common) > 5:
            lines.append(f"[dim]  ... and {len(common) - 5} more[/dim]")
    if only_a:
        lines.append(
            f"[cyan]Only {label_a} ({len(only_a)}):[/cyan] {', '.join(only_a[:5])}"
        )
        if len(only_a) > 5:
            lines.append(f"[cyan]  ... and {len(only_a) - 5} more[/cyan]")
    if only_b:
        lines.append(
            f"[magenta]Only {label_b} ({len(only_b)}):[/magenta] {', '.join(only_b[:5])}"
        )
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


@diff_app.command("thesis")
def diff_thesis(
    thesis_id_1: str = typer.Argument(..., help="First thesis ID."),
    thesis_id_2: str = typer.Argument(..., help="Second thesis ID."),
    json_out: bool = typer.Option(False, "--json", help="Emit diff as JSON."),
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

    payload = build_thesis_diff_payload(
        thesis_a,
        thesis_b,
        id_a=thesis_id_1,
        id_b=thesis_id_2,
    )
    if json_out:
        print_json_stdout(payload)
        return

    if payload["cross_symbol"]:
        console.print(
            f"[yellow]Warning:[/yellow] Comparing theses for different symbols "
            f"({thesis_a.symbol} vs {thesis_b.symbol})"
        )
    diff_theses(thesis_a, thesis_b, id_a=thesis_id_1, id_b=thesis_id_2)


def _load_run_pair(
    service: ThesisService, run_id_1: str, run_id_2: str
) -> tuple[Any, Any]:
    run_a = service.get_research_run(run_id_1)
    if not run_a:
        console.print(f"[red]Research run not found:[/red] {run_id_1}")
        raise typer.Exit(code=1)
    run_b = service.get_research_run(run_id_2)
    if not run_b:
        console.print(f"[red]Research run not found:[/red] {run_id_2}")
        raise typer.Exit(code=1)
    return run_a, run_b


@diff_app.command("run")
def diff_run(
    run_id_1: str = typer.Argument(..., help="First research run ID."),
    run_id_2: str = typer.Argument(..., help="Second research run ID."),
    json_out: bool = typer.Option(False, "--json", help="Emit diff as JSON."),
) -> None:
    """Compare two research runs — signals, thesis, debate stance, analyst opinions."""
    service = _service()
    run_a, run_b = _load_run_pair(service, run_id_1, run_id_2)

    thesis_a = service.get_thesis(run_a.thesis_id) if run_a.thesis_id else None
    thesis_b = service.get_thesis(run_b.thesis_id) if run_b.thesis_id else None
    payload = build_run_diff_payload(
        run_a,
        run_b,
        id_a=run_id_1,
        id_b=run_id_2,
        thesis_a=thesis_a,
        thesis_b=thesis_b,
    )
    if json_out:
        print_json_stdout(payload)
        return

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
