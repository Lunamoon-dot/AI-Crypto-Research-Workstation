"""Post-run terminal summary aligned with Phase 7 ROADMAP templates."""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.panel import Panel


def _freshness_hint(service: Any | None, run: Any | None) -> str:
    if not service or not run or not getattr(run, "signal_snapshot_id", None):
        return "unknown"
    snap = service.get_signal_snapshot(run.signal_snapshot_id)
    if not snap:
        return "unknown"
    total = getattr(snap, "signal_count", 0) or 0
    stale = getattr(snap, "stale_count", 0) or 0
    unknown_f = getattr(snap, "unknown_freshness_count", 0) or 0
    if total <= 0:
        return "no signals captured"
    if stale == 0 and unknown_f == 0:
        return "ok"
    if stale > 0:
        return f"warnings ({stale} stale signal(s))"
    return f"mixed ({unknown_f} unknown freshness)"


def emit_research_run_complete_panel(
    console: Console,
    *,
    graph: Any,
    selections: dict,
    rating: str,
    config: dict,
) -> None:
    """Print a concise Rich panel after a CLI research run completes."""
    run = getattr(graph, "current_research_run", None)
    debate = getattr(graph, "current_debate", None)
    bridge = getattr(graph, "journal_bridge", None)
    service = getattr(bridge, "service", None) if bridge is not None else None

    lines = [
        f"Symbol: {selections.get('ticker', 'N/A')}",
        f"Analysis date: {selections.get('analysis_date', 'N/A')}",
    ]

    if run and getattr(run, "id", None):
        lines.extend(
            [
                f"Run ID: {run.id}",
                f"Status: {run.status.value if getattr(run.status, 'value', None) else run.status}",
                f"Market Snapshot: {run.market_snapshot_id or 'N/A'}",
                f"Signal Snapshot: {run.signal_snapshot_id or 'N/A'}",
                f"Debate: {run.debate_id or 'N/A'}",
                f"Thesis: {run.thesis_id or 'N/A'}",
            ]
        )
        conflict = getattr(debate, "conflict_level", None)
        stance = getattr(debate, "consensus_stance", None)
        lines.extend(
            [
                "",
                (
                    "Consensus stance: "
                    f"{stance.value if stance is not None and getattr(stance, 'value', None) else 'N/A'}"
                ),
                (
                    "Conflict: "
                    f"{conflict.value if conflict is not None and getattr(conflict, 'value', None) else 'N/A'}"
                ),
                f"PM rating: {rating}",
                f"Signal freshness (snapshot): {_freshness_hint(service, run)}",
            ]
        )
    else:
        lines.extend(
            [
                "",
                "Journal: no persisted run rows (journal disabled or init failed).",
                f"PM rating: {rating}",
            ]
        )

    next_cmds: list[str] = []
    if run and run.id:
        next_cmds.append(f"tradingagents journal workspace {run.id}")
        next_cmds.append(f"tradingagents research workspace {run.id}")
    else:
        next_cmds.append("tradingagents journal list")
        next_cmds.append("tradingagents journal workspace <run_id>")
    thesis_id = getattr(run, "thesis_id", None) if run else None
    if thesis_id:
        next_cmds.append(f"tradingagents thesis show {thesis_id}")
        next_cmds.append(f"tradingagents watchlist add-thesis {thesis_id}")
    next_cmds.append("tradingagents evaluate matured")

    lines.extend(["", "[bold]Next[/bold]", *[f"- {c}" for c in next_cmds]])

    j_en = config.get("journal", {}).get("enabled", True)
    footer = "[dim]Research workstation — output is analysis only, not financial advice.[/dim]"
    if not j_en:
        footer += " [dim]Journal persistence is off (`journal.enabled`).[/dim]"

    console.print(
        Panel("\n".join(lines), title="Research run complete", border_style="cyan")
    )
    console.print(footer)
