"""Decision journal and thesis lifecycle commands."""

from __future__ import annotations

from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    OutcomeResult,
    OutcomeReview,
    UserDecision,
    UserDecisionAction,
)
from tradingagents.services import JournalService

console = Console()
journal_app = typer.Typer(help="Inspect saved research runs.")
thesis_app = typer.Typer(help="Inspect and update saved trade theses.")


def _service() -> JournalService:
    return JournalService(DEFAULT_CONFIG)


@journal_app.command("path")
def journal_path():
    """Show the local SQLite journal path."""
    service = _service()
    console.print(str(service.db_path))


@journal_app.command("list")
def journal_list(
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
):
    """List recent research runs."""
    runs = _service().list_research_runs(limit=limit)
    if not runs:
        console.print("[yellow]No research runs saved yet.[/yellow]")
        return

    table = Table(title="Research Runs")
    table.add_column("ID", style="cyan", overflow="fold")
    table.add_column("Symbol")
    table.add_column("Status")
    table.add_column("Started")
    table.add_column("Thesis")

    for run in runs:
        table.add_row(
            run.id or "",
            run.symbol,
            run.status.value,
            run.started_at.isoformat(),
            run.thesis_id or "",
        )
    console.print(table)


@journal_app.command("show")
def journal_show(
    run_id: str = typer.Argument(..., help="Research run id."),
):
    """Show a saved research run."""
    run = _service().get_research_run(run_id)
    if not run:
        console.print(f"[red]Research run not found:[/red] {run_id}")
        raise typer.Exit(1)

    lines = [
        f"ID: {run.id}",
        f"Symbol: {run.symbol}",
        f"Asset Class: {run.asset_class}",
        f"Timeframe: {run.timeframe or 'N/A'}",
        f"Status: {run.status.value}",
        f"Started: {run.started_at.isoformat()}",
        f"Completed: {run.completed_at.isoformat() if run.completed_at else 'N/A'}",
        f"Market Snapshot: {run.market_snapshot_id or 'N/A'}",
        f"Signal Snapshot: {run.signal_snapshot_id or 'N/A'}",
        f"Signals: {len(run.signal_ids)}",
        f"Debate: {run.debate_id or 'N/A'}",
        f"Thesis: {run.thesis_id or 'N/A'}",
        f"User Decision: {run.user_decision_id or 'N/A'}",
        f"Outcome Review: {run.outcome_review_id or 'N/A'}",
    ]
    console.print(Panel("\n".join(lines), title="Research Run", border_style="cyan"))


@journal_app.command("timeline")
def journal_timeline(
    run_id: str = typer.Argument(..., help="Research run id."),
    limit: int = typer.Option(200, "--limit", "-n", min=1, max=500),
):
    """Show the persisted timeline for a research run."""
    service = _service()
    if not service.get_research_run(run_id):
        console.print(f"[red]Research run not found:[/red] {run_id}")
        raise typer.Exit(1)
    events = service.list_timeline_events(research_run_id=run_id, limit=limit)
    _print_timeline(events, title=f"Research Run Timeline: {run_id}")


@journal_app.command("market-snapshot")
def journal_market_snapshot(
    snapshot_id: str = typer.Argument(..., help="Market snapshot id."),
):
    """Show a saved market snapshot."""
    snapshot = _service().get_market_snapshot(snapshot_id)
    if not snapshot:
        console.print(f"[red]Market snapshot not found:[/red] {snapshot_id}")
        raise typer.Exit(1)

    lines = [
        f"ID: {snapshot.id}",
        f"Research Run: {snapshot.research_run_id or 'N/A'}",
        f"Symbol: {snapshot.symbol}",
        f"Captured: {snapshot.captured_at.isoformat()}",
        f"Price: {snapshot.current_price if snapshot.current_price is not None else 'N/A'}",
        f"Trend: {snapshot.trend_direction}",
        f"Trend Strength: {snapshot.trend_strength if snapshot.trend_strength is not None else 'N/A'}",
        f"Volatility: {snapshot.volatility_regime}",
        f"Regime: {snapshot.market_regime}",
        f"Source: {snapshot.source}",
        f"Source Timestamp: {snapshot.source_timestamp.isoformat() if snapshot.source_timestamp else 'N/A'}",
        "",
        "Summary:",
        snapshot.summary or "N/A",
    ]
    console.print(Panel("\n".join(lines), title="Market Snapshot", border_style="cyan"))


@journal_app.command("signal-snapshot")
def journal_signal_snapshot(
    snapshot_id: str = typer.Argument(..., help="Signal snapshot id."),
):
    """Show a saved signal snapshot."""
    snapshot = _service().get_signal_snapshot(snapshot_id)
    if not snapshot:
        console.print(f"[red]Signal snapshot not found:[/red] {snapshot_id}")
        raise typer.Exit(1)

    lines = [
        f"ID: {snapshot.id}",
        f"Research Run: {snapshot.research_run_id}",
        f"Symbol: {snapshot.symbol}",
        f"Captured: {snapshot.captured_at.isoformat()}",
        f"Composite Signal: {snapshot.composite_signal_id or 'N/A'}",
        f"Signal Count: {len(snapshot.signal_ids)}",
        f"Bullish: {snapshot.bullish_count}",
        f"Bearish: {snapshot.bearish_count}",
        f"Neutral: {snapshot.neutral_count}",
        f"Stale: {snapshot.stale_count}",
        f"Unknown Freshness: {snapshot.unknown_freshness_count}",
        "",
        "Signal IDs:",
    ]
    lines.extend(f"- {signal_id}" for signal_id in snapshot.signal_ids)
    console.print(Panel("\n".join(lines), title="Signal Snapshot", border_style="cyan"))


@journal_app.command("debate")
def journal_debate(
    debate_id: str = typer.Argument(..., help="Research debate id."),
):
    """Show a saved research debate and its structured opinions."""
    service = _service()
    debate = service.get_debate(debate_id)
    if not debate:
        console.print(f"[red]Research debate not found:[/red] {debate_id}")
        raise typer.Exit(1)

    confidence = (
        f"{debate.consensus_confidence:.0%}"
        if debate.consensus_confidence is not None
        else "N/A"
    )
    lines = [
        f"ID: {debate.id}",
        f"Research Run: {debate.research_run_id or 'N/A'}",
        f"Symbol: {debate.symbol}",
        f"Consensus: {debate.consensus_stance.value}",
        f"Consensus Confidence: {confidence}",
        f"Conflict: {debate.conflict_level.value}",
        f"Opinion Count: {len(debate.opinion_ids)}",
    ]
    if debate.contradictions:
        lines.extend(["", "Contradictions:"])
        lines.extend(f"- {item}" for item in debate.contradictions)
    if debate.missing_data:
        lines.extend(["", "Missing Data:"])
        lines.extend(f"- {item}" for item in debate.missing_data)
    console.print(Panel("\n".join(lines), title="Research Debate", border_style="cyan"))

    opinions = service.list_agent_opinions(debate_id=debate.id)
    if opinions:
        table = Table(title="Agent Opinions")
        table.add_column("Agent")
        table.add_column("Role")
        table.add_column("Stance")
        table.add_column("Confidence")
        table.add_column("Evidence")
        for opinion in opinions:
            opinion_confidence = (
                f"{opinion.confidence:.0%}" if opinion.confidence is not None else "N/A"
            )
            table.add_row(
                opinion.agent_name,
                opinion.role,
                opinion.stance.value,
                opinion_confidence,
                "\n".join(opinion.key_evidence[:2]),
            )
        console.print(table)


@thesis_app.command("list")
def thesis_list(
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
):
    """List recent trade theses."""
    theses = _service().list_theses(limit=limit)
    if not theses:
        console.print("[yellow]No theses saved yet.[/yellow]")
        return

    table = Table(title="Trade Theses")
    table.add_column("ID", style="cyan", overflow="fold")
    table.add_column("Symbol")
    table.add_column("Direction")
    table.add_column("Confidence")
    table.add_column("Created")

    for thesis in theses:
        confidence = f"{thesis.confidence:.0%}" if thesis.confidence is not None else "N/A"
        table.add_row(
            thesis.id or "",
            thesis.symbol,
            thesis.direction.value,
            confidence,
            thesis.created_at.isoformat(),
        )
    console.print(table)


@thesis_app.command("show")
def thesis_show(
    thesis_id: str = typer.Argument(..., help="Trade thesis id."),
):
    """Show a saved trade thesis."""
    thesis = _service().get_thesis(thesis_id)
    if not thesis:
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)

    confidence = f"{thesis.confidence:.0%}" if thesis.confidence is not None else "N/A"
    lines = [
        f"ID: {thesis.id}",
        f"Research Run: {thesis.research_run_id or 'N/A'}",
        f"Debate: {thesis.debate_id or 'N/A'}",
        f"Symbol: {thesis.symbol}",
        f"Direction: {thesis.direction.value}",
        f"Setup: {thesis.setup_type}",
        f"Confidence: {confidence}",
        "",
        "Thesis:",
        thesis.thesis_text,
    ]
    if thesis.risk_notes:
        lines.extend(["", "Risk Notes:"])
        lines.extend(f"- {note}" for note in thesis.risk_notes)
    if thesis.contradictions:
        lines.extend(["", "Contradictions:"])
        lines.extend(f"- {item}" for item in thesis.contradictions)
    console.print(Panel("\n".join(lines), title="Trade Thesis", border_style="cyan"))


@thesis_app.command("timeline")
def thesis_timeline(
    thesis_id: str = typer.Argument(..., help="Trade thesis id."),
    limit: int = typer.Option(200, "--limit", "-n", min=1, max=500),
):
    """Show the persisted lifecycle timeline for a thesis."""
    service = _service()
    if not service.get_thesis(thesis_id):
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)
    events = service.list_timeline_events(thesis_id=thesis_id, limit=limit)
    _print_timeline(events, title=f"Thesis Timeline: {thesis_id}")


@thesis_app.command("decide")
def thesis_decide(
    thesis_id: str = typer.Argument(..., help="Trade thesis id."),
    action: str = typer.Argument(
        ...,
        help="accepted, rejected, watched, ignored, or needs_more_research.",
    ),
    notes: str = typer.Option("", "--notes", "-m", help="Decision notes."),
):
    """Record the user's manual decision for a thesis."""
    try:
        parsed_action = UserDecisionAction(action)
    except ValueError:
        allowed = ", ".join(item.value for item in UserDecisionAction)
        console.print(f"[red]Invalid action.[/red] Allowed: {allowed}")
        raise typer.Exit(1)

    service = _service()
    if not service.get_thesis(thesis_id):
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)

    decision = service.record_user_decision(
        UserDecision(thesis_id=thesis_id, action=parsed_action, user_notes=notes)
    )
    console.print(f"[green]Decision saved:[/green] {decision.id}")


@thesis_app.command("review")
def thesis_review(
    thesis_id: str = typer.Argument(..., help="Trade thesis id."),
    result: str = typer.Argument(
        ...,
        help="hit_target, invalidated, mixed, expired, or unknown.",
    ),
    lessons: str = typer.Option("", "--lessons", "-m", help="Outcome lessons."),
    mfe: Optional[float] = typer.Option(None, "--mfe", help="Max favorable excursion."),
    mae: Optional[float] = typer.Option(None, "--mae", help="Max adverse excursion."),
    invalidated: bool = typer.Option(False, "--invalidated", help="Mark as invalidated."),
):
    """Record an outcome review for a thesis."""
    try:
        parsed_result = OutcomeResult(result)
    except ValueError:
        allowed = ", ".join(item.value for item in OutcomeResult)
        console.print(f"[red]Invalid result.[/red] Allowed: {allowed}")
        raise typer.Exit(1)

    service = _service()
    if not service.get_thesis(thesis_id):
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)

    review = service.record_outcome_review(
        OutcomeReview(
            thesis_id=thesis_id,
            result=parsed_result,
            max_favorable_excursion=mfe,
            max_adverse_excursion=mae,
            invalidated=invalidated or parsed_result == OutcomeResult.INVALIDATED,
            lessons=lessons,
        )
    )
    console.print(f"[green]Outcome review saved:[/green] {review.id}")


def _print_timeline(events, *, title: str) -> None:
    if not events:
        console.print("[yellow]No timeline events saved yet.[/yellow]")
        return

    table = Table(title=title)
    table.add_column("Time")
    table.add_column("Event")
    table.add_column("Message")
    table.add_column("Thesis")
    for event in events:
        table.add_row(
            event.created_at.isoformat(),
            event.event_type,
            event.message,
            event.thesis_id or "",
        )
    console.print(table)


def register_journal(parent_app: typer.Typer) -> None:
    """Mount journal and thesis command groups on the main CLI app."""
    parent_app.add_typer(journal_app, name="journal")
    parent_app.add_typer(thesis_app, name="thesis")
