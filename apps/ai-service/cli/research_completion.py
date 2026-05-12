"""Post-run terminal summary aligned with Phase 7 ROADMAP templates."""

from __future__ import annotations

import re
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


def _clean_text(value: Any, *, limit: int = 180) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"[*_`#]+", "", text)
    text = text.replace("\n", " ")
    text = text.replace("|", " ")
    text = re.sub(r"\s+", " ", text).strip(" -")
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _percent(value: Any) -> str:
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.0%}"
    except (TypeError, ValueError):
        return str(value)


def _value(value: Any) -> str:
    raw = getattr(value, "value", None)
    if raw is not None:
        return str(raw)
    return str(value) if value is not None else "N/A"


def _bottom_line(thesis_text: str | None) -> str:
    if not thesis_text:
        return ""
    match = re.search(
        r"(?:\*\*)?Bottom Line(?:\*\*)?\s*:\s*(.+?)(?:\n\s*\n|$)",
        thesis_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return _clean_text(match.group(1), limit=240)
    for line in thesis_text.splitlines():
        cleaned = _clean_text(line, limit=240)
        if cleaned and not cleaned.lower().startswith(("decision:", "rating:")):
            return cleaned
    return _clean_text(thesis_text, limit=240)


def _thesis_summary(service: Any | None, thesis_id: str | None) -> list[str]:
    if not service or not thesis_id:
        return []
    thesis = service.get_thesis(thesis_id)
    if not thesis:
        return []

    lines = [
        "[bold]Readable Summary[/bold]",
        f"Thesis direction: {_value(getattr(thesis, 'direction', None))}",
        f"Confidence: {_percent(getattr(thesis, 'confidence', None))}",
    ]
    entry = _clean_text(getattr(thesis, "entry_zone", None))
    invalidation = _clean_text(
        getattr(thesis, "invalidation_level", None)
        or getattr(thesis, "invalidation", None)
    )
    targets = [
        _clean_text(target, limit=90)
        for target in getattr(thesis, "target_zones", [])[:3]
        if _clean_text(target, limit=90)
    ]
    if entry:
        lines.append(f"Entry/Catalyst: {entry}")
    if invalidation:
        lines.append(f"Invalidation: {invalidation}")
    if targets:
        lines.append(f"Targets: {'; '.join(targets)}")
    bottom = _bottom_line(getattr(thesis, "thesis_text", None))
    if bottom:
        lines.extend(["", f"Bottom line: {bottom}"])
    return lines


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
                f"Status: {run.completion_label() if hasattr(run, 'completion_label') else (run.status.value if getattr(run.status, 'value', None) else run.status)}",
            ]
        )
        if getattr(run, "degradation_reasons", None):
            lines.extend(
                [
                    "Completion Quality: degraded",
                    *[f"- {item}" for item in run.degradation_reasons],
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
        summary = _thesis_summary(service, getattr(run, "thesis_id", None))
        if summary:
            lines.extend(["", *summary])
        ids = [f"run={run.id}"]
        if getattr(run, "thesis_id", None):
            ids.append(f"thesis={run.thesis_id}")
        if getattr(run, "signal_snapshot_id", None):
            ids.append(f"signals={run.signal_snapshot_id}")
        lines.extend(["", f"Record IDs: {', '.join(ids)}"])
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
