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
    TradeThesis,
    UserDecision,
    UserDecisionAction,
)
from tradingagents.services import JournalService

from cli.json_emit import print_json_stdout

console = Console()
journal_app = typer.Typer(help="Inspect saved research runs.")
thesis_app = typer.Typer(help="Inspect and update saved trade theses.")


def _service() -> JournalService:
    return JournalService(DEFAULT_CONFIG)


def _workspace_evidence_lines(
    *,
    thesis: TradeThesis | None,
    debate,
) -> list[str]:
    """Short supporting/contradiction summary aligned with Phase 7."""
    lines: list[str] = ["Supporting vs contradicting (persisted):"]
    if thesis:
        sup_s = thesis.supporting_signal_ids
        con_s = thesis.contradicting_signal_ids
        lines.append(
            f"- Classified signals: {len(sup_s)} supporting, {len(con_s)} contradicting "
            "(see `signals show <id>` for provenance)."
        )
        evid = thesis.evidence or {}
        sup_o = evid.get("supporting_opinion_ids") or []
        con_o = evid.get("contradicting_opinion_ids") or []
        lines.append(
            f"- Classified analyst opinions: {len(sup_o)} supporting, {len(con_o)} contradicting."
        )
        if thesis.contradictions:
            lines.append("- Thesis contradiction notes:")
            lines.extend(f"  • {item}" for item in thesis.contradictions[:8])
    else:
        lines.append("- Thesis artifact not persisted for this run yet.")
    if debate and debate.contradictions:
        lines.append("- Debate contradiction notes:")
        lines.extend(f"  • {item}" for item in debate.contradictions[:8])
    return lines


def _workspace_json_payload(service: JournalService, run_id: str) -> dict:
    run = service.get_research_run(run_id)
    if not run:
        raise ValueError(run_id)

    debate = service.get_debate(run.debate_id) if run.debate_id else None
    thesis = service.get_thesis(run.thesis_id) if run.thesis_id else None
    opinions = (
        service.list_agent_opinions(debate_id=debate.id) if debate and debate.id else []
    )
    scenarios = (
        service.list_scenarios(thesis_id=thesis.id) if thesis and thesis.id else []
    )
    events = service.list_timeline_events(research_run_id=run.id)
    signal_snap = {}
    market_snap = {}
    if run.signal_snapshot_id:
        ss = service.get_signal_snapshot(run.signal_snapshot_id)
        if ss:
            signal_snap = ss.model_dump(mode="json")
    if run.market_snapshot_id:
        ms = service.get_market_snapshot(run.market_snapshot_id)
        if ms:
            market_snap = ms.model_dump(mode="json")

    return {
        "run": run.model_dump(mode="json"),
        "market_snapshot": market_snap or None,
        "signal_snapshot": signal_snap or None,
        "debate": debate.model_dump(mode="json") if debate else None,
        "agent_opinions": [o.model_dump(mode="json") for o in opinions],
        "trade_thesis": thesis.model_dump(mode="json") if thesis else None,
        "scenarios": [s.model_dump(mode="json") for s in scenarios],
        "timeline_events": [e.model_dump(mode="json") for e in events],
        "evidence_notes": _workspace_evidence_lines(thesis=thesis, debate=debate),
        "next_commands": [
            f"tradingagents journal timeline {run.id}",
            *(
                [
                    f"tradingagents thesis show {run.thesis_id}",
                    f"tradingagents watchlist add-thesis {run.thesis_id}",
                ]
                if run.thesis_id
                else []
            ),
            *(
                [f"tradingagents journal debate {run.debate_id}"]
                if run.debate_id
                else []
            ),
        ],
    }


@journal_app.command("path")
def journal_path():
    """Show the local SQLite journal path."""
    service = _service()
    console.print(str(service.db_path))


@journal_app.command("list")
def journal_list(
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="Print runs as JSON."),
):
    """List recent research runs."""
    runs = _service().list_research_runs(limit=limit)
    if not runs:
        if json_out:
            print_json_stdout([])
        else:
            console.print("[yellow]No research runs saved yet.[/yellow]")
        return

    if json_out:
        print_json_stdout({"runs": [run.model_dump(mode="json") for run in runs]})
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
    json_out: bool = typer.Option(False, "--json", help="Print run as JSON."),
):
    """Show a saved research run."""
    run = _service().get_research_run(run_id)
    if not run:
        console.print(f"[red]Research run not found:[/red] {run_id}")
        raise typer.Exit(1)

    if json_out:
        print_json_stdout({"run": run.model_dump(mode="json")})
        return

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


@journal_app.command("workspace")
def journal_workspace(
    run_id: str = typer.Argument(..., help="Research run id."),
    json_out: bool = typer.Option(False, "--json", help="Emit workspace snapshot as JSON."),
):
    """Show a full research workspace summary for one run."""
    service = _service()
    run = service.get_research_run(run_id)
    if not run:
        console.print(f"[red]Research run not found:[/red] {run_id}")
        raise typer.Exit(1)

    if json_out:
        print_json_stdout(_workspace_json_payload(service, run_id))
        return

    lines = [
        f"ID: {run.id}",
        f"Symbol: {run.symbol}",
        f"Status: {run.status.value}",
        f"Timeframe: {run.timeframe or 'N/A'}",
        f"Market Snapshot: {run.market_snapshot_id or 'N/A'}",
        f"Signal Snapshot: {run.signal_snapshot_id or 'N/A'}",
        f"Signals: {len(run.signal_ids)}",
        f"Debate: {run.debate_id or 'N/A'}",
        f"Thesis: {run.thesis_id or 'N/A'}",
    ]
    console.print(Panel("\n".join(lines), title="Research Workspace", border_style="cyan"))
    next_commands = [
        f"tradingagents journal timeline {run.id}",
    ]
    if run.thesis_id:
        next_commands.extend([
            f"tradingagents thesis show {run.thesis_id}",
            f"tradingagents watchlist add-thesis {run.thesis_id}",
        ])
    if run.debate_id:
        next_commands.append(f"tradingagents journal debate {run.debate_id}")

    debate = service.get_debate(run.debate_id) if run.debate_id else None
    if debate:
        confidence = (
            f"{debate.consensus_confidence:.0%}"
            if debate.consensus_confidence is not None
            else "N/A"
        )
        debate_lines = [
            f"Consensus: {debate.consensus_stance.value}",
            f"Confidence: {confidence}",
            f"Conflict: {debate.conflict_level.value}",
            f"Opinions: {len(debate.opinion_ids)}",
        ]
        if debate.contradictions:
            debate_lines.extend(["", "Contradictions:"])
            debate_lines.extend(f"- {item}" for item in debate.contradictions)
        if debate.missing_data:
            debate_lines.extend(["", "Missing Data:"])
            debate_lines.extend(f"- {item}" for item in debate.missing_data)
        console.print(Panel("\n".join(debate_lines), title="Debate", border_style="magenta"))
        _print_opinions_table(service.list_agent_opinions(debate_id=debate.id))
    else:
        console.print("[yellow]No structured debate saved for this run yet.[/yellow]")

    thesis = service.get_thesis(run.thesis_id) if run.thesis_id else None
    if thesis:
        thesis_lines = [
            f"Direction: {thesis.direction.value}",
            f"Setup: {thesis.setup_type}",
            f"Confidence: {_fmt_pct(thesis.confidence)}",
            f"Supporting Signals: {len(thesis.supporting_signal_ids)}",
            f"Contradicting Signals: {len(thesis.contradicting_signal_ids)}",
            f"Supporting Opinions: {len(thesis.evidence.get('supporting_opinion_ids', []))}",
            f"Contradicting Opinions: {len(thesis.evidence.get('contradicting_opinion_ids', []))}",
            "",
            "Thesis:",
            thesis.thesis_text,
        ]
        if thesis.evidence.get("confidence_adjustment_reason"):
            thesis_lines.extend(["", thesis.evidence["confidence_adjustment_reason"]])
        console.print(Panel("\n".join(thesis_lines), title="Trade Thesis", border_style="green"))
        console.print(
            Panel(
                "\n".join(_workspace_evidence_lines(thesis=thesis, debate=debate)),
                title="Supporting / Contradicting evidence",
                border_style="blue",
            )
        )

        scenarios = service.list_scenarios(thesis_id=thesis.id)
        if scenarios:
            scenario_table = Table(title="Scenarios")
            scenario_table.add_column("Probability")
            scenario_table.add_column("Condition")
            scenario_table.add_column("Action")
            for scenario in scenarios:
                scenario_table.add_row(
                    scenario.probability_band.value,
                    scenario.condition,
                    scenario.suggested_user_action,
                )
            console.print(scenario_table)
        else:
            console.print("[yellow]No scenarios saved for this thesis yet.[/yellow]")
    else:
        console.print("[yellow]No thesis saved for this run yet.[/yellow]")
        if debate:
            console.print(
                Panel(
                    "\n".join(_workspace_evidence_lines(thesis=None, debate=debate)),
                    title="Supporting / Contradicting evidence",
                    border_style="blue",
                )
            )

    events = service.list_timeline_events(research_run_id=run.id)
    if events:
        _print_timeline(events, title="Workspace Timeline")
    console.print(
        Panel(
            "\n".join(f"- {command}" for command in next_commands),
            title="Next Useful Commands",
            border_style="blue",
        )
    )


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
        _print_opinions_table(opinions)


@journal_app.command("outcomes")
def journal_outcomes(
    symbol: Optional[str] = typer.Option(None, "--symbol", "-s", help="Filter by symbol."),
    limit: int = typer.Option(50, "--limit", "-n", min=1, max=500),
):
    """List saved thesis outcome reviews."""
    service = _service()
    reviews = service.list_outcome_reviews(symbol=symbol, limit=limit)
    if not reviews:
        console.print("[yellow]No outcome reviews saved yet.[/yellow]")
        return

    table = Table(title="Outcome Reviews")
    table.add_column("ID", style="cyan", overflow="fold")
    table.add_column("Thesis")
    table.add_column("Result")
    table.add_column("Invalidated")
    table.add_column("MFE")
    table.add_column("MAE")
    table.add_column("Reviewed")
    for review in reviews:
        table.add_row(
            review.id or "",
            review.thesis_id,
            review.result.value,
            "yes" if review.invalidated else "no",
            _fmt_number(review.max_favorable_excursion),
            _fmt_number(review.max_adverse_excursion),
            review.reviewed_at.isoformat(),
        )
    console.print(table)


@journal_app.command("retrospective")
def journal_retrospective(
    symbol: Optional[str] = typer.Option(None, "--symbol", "-s", help="Filter by symbol."),
    limit: int = typer.Option(100, "--limit", "-n", min=1, max=500),
):
    """Show outcome analytics and retrospective insights."""
    analytics = _service().build_outcome_analytics(symbol=symbol, limit=limit)
    lines = [
        f"Symbol: {analytics.symbol or 'All'}",
        f"Reviewed Outcomes: {analytics.sample_size}",
        f"Hit Rate: {_fmt_pct(analytics.hit_rate)}",
        f"Invalidation Rate: {_fmt_pct(analytics.invalidation_rate)}",
        f"Mixed Rate: {_fmt_pct(analytics.mixed_rate)}",
        f"Average MFE: {_fmt_number(analytics.average_mfe)}",
        f"Average MAE: {_fmt_number(analytics.average_mae)}",
        "",
        "Result Counts:",
    ]
    if analytics.result_counts:
        lines.extend(f"- {key}: {value}" for key, value in analytics.result_counts.items())
    else:
        lines.append("- none")
    console.print(Panel("\n".join(lines), title="Outcome Analytics", border_style="cyan"))

    if analytics.insights:
        table = Table(title="Retrospective Insights")
        table.add_column("Type")
        table.add_column("Evidence")
        table.add_column("Message")
        for insight in analytics.insights:
            table.add_row(
                insight.insight_type,
                str(insight.evidence_count),
                insight.message,
            )
        console.print(table)

    if analytics.recent_lessons:
        console.print(
            Panel(
                "\n".join(f"- {lesson}" for lesson in analytics.recent_lessons),
                title="Recent Lessons",
                border_style="yellow",
            )
        )


@thesis_app.command("list")
def thesis_list(
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
    json_out: bool = typer.Option(False, "--json", help="Print theses as JSON."),
):
    """List recent trade theses."""
    theses = _service().list_theses(limit=limit)
    if not theses:
        if json_out:
            print_json_stdout([])
        else:
            console.print("[yellow]No theses saved yet.[/yellow]")
        return

    if json_out:
        print_json_stdout({"theses": [th.model_dump(mode="json") for th in theses]})
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
    json_out: bool = typer.Option(False, "--json", help="Print thesis as JSON."),
):
    """Show a saved trade thesis."""
    thesis = _service().get_thesis(thesis_id)
    if not thesis:
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)

    if json_out:
        print_json_stdout({"thesis": thesis.model_dump(mode="json")})
        return

    confidence = f"{thesis.confidence:.0%}" if thesis.confidence is not None else "N/A"
    created = thesis.created_at.strftime("%Y-%m-%d %H:%M UTC") if thesis.created_at else "N/A"
    lines = [
        f"ID: {thesis.id}",
        f"Research Run: {thesis.research_run_id or 'N/A'}",
        f"Debate: {thesis.debate_id or 'N/A'}",
        f"Symbol: {thesis.symbol}",
        f"Direction: {thesis.direction.value}",
        f"Setup: {thesis.setup_type}",
        f"Confidence: {confidence}",
        f"Created: {created}",
    ]

    # ── Price Levels ──
    if thesis.entry_zone or thesis.invalidation_level or thesis.target_zones:
        lines.append("")
        lines.append("Price Levels:")
        if thesis.entry_zone:
            lines.append(f"  Entry Zone: {thesis.entry_zone}")
        if thesis.invalidation_level:
            lines.append(f"  Invalidation: {thesis.invalidation_level}")
        if thesis.target_zones:
            lines.append("  Target Zones:")
            for tz in thesis.target_zones:
                lines.append(f"    - {tz}")

    # ── Thesis Text ──
    lines.extend(["", "Thesis:", thesis.thesis_text])

    # ── Risk & Contradictions ──
    if thesis.risk_notes:
        lines.extend(["", "Risk Notes:"])
        lines.extend(f"- {note}" for note in thesis.risk_notes)
    if thesis.contradictions:
        lines.extend(["", "Contradictions:"])
        lines.extend(f"- {item}" for item in thesis.contradictions)

    # ── Signal Evidence ──
    if thesis.supporting_signal_ids or thesis.contradicting_signal_ids:
        lines.append("")
        lines.append("Signal Evidence:")
        if thesis.supporting_signal_ids:
            lines.append(
                f"  Supporting ({len(thesis.supporting_signal_ids)}): "
                + ", ".join(thesis.supporting_signal_ids)
            )
        if thesis.contradicting_signal_ids:
            lines.append(
                f"  Contradicting ({len(thesis.contradicting_signal_ids)}): "
                + ", ".join(thesis.contradicting_signal_ids)
            )

    # ── Agent Opinions ──
    if thesis.agent_opinion_ids:
        lines.append("")
        lines.append(f"Agent Opinions ({len(thesis.agent_opinion_ids)}):")
        evidence = thesis.evidence or {}
        supporting = evidence.get("supporting_opinion_ids", [])
        contradicting = evidence.get("contradicting_opinion_ids", [])
        if supporting:
            lines.append(f"  Supporting: {', '.join(supporting)}")
        if contradicting:
            lines.append(f"  Contradicting: {', '.join(contradicting)}")

    # ── Consensus ──
    if thesis.consensus:
        consensus = thesis.consensus
        lines.append("")
        lines.append("Consensus:")
        stance = consensus.get("stance") or "N/A"
        conf_val = consensus.get("confidence")
        conflict = consensus.get("conflict_level") or "N/A"
        counts = consensus.get("stance_counts") or {}
        lines.append(f"  Stance: {stance}")
        if conf_val is not None:
            lines.append(f"  Confidence: {conf_val:.2f}")
        lines.append(f"  Conflict Level: {conflict}")
        if counts:
            lines.append(f"  Stance Counts: {counts}")

    # ── Confidence Calibration ──
    if thesis.evidence:
        evidence = thesis.evidence
        lines.append("")
        lines.append("Confidence Calibration:")
        rating = evidence.get("rating") or "N/A"
        lines.append(f"  Rating: {rating}")
        missing = evidence.get("missing_data") or []
        if missing:
            lines.append(f"  Missing Data ({len(missing)}): {', '.join(missing[:5])}")
        conflict = evidence.get("conflict_level")
        if conflict:
            lines.append(f"  Conflict Level: {conflict}")
        reason = evidence.get("confidence_adjustment_reason") or ""
        if reason:
            lines.append(f"  Adjustment: {reason}")

    # ── Explainability Checklist ──
    evidence_bag = thesis.evidence or {}
    consensus_bag = thesis.consensus or {}
    lines.append("")
    lines.append("Quick Check:")
    # 1. Signal consensus
    sup = len(thesis.supporting_signal_ids)
    con = len(thesis.contradicting_signal_ids)
    lines.append(f"  Signals:       {sup} support / {con} contradict")
    # 2. Data gaps
    missing = evidence_bag.get("missing_data") or []
    if missing:
        lines.append(f"  Data Gaps:     {len(missing)} — {missing[0][:60]}")
    else:
        lines.append("  Data Gaps:     none reported")
    # 3. Debate consensus
    conflict = consensus_bag.get("conflict_level") or evidence_bag.get("conflict_level") or "N/A"
    stance = consensus_bag.get("stance") or "N/A"
    lines.append(f"  Consensus:     {conflict} conflict, stance={stance}")
    # 4. Invalidation trigger
    inval = thesis.invalidation_level or "not specified"
    lines.append(f"  Invalidation:  {inval}")
    # 5. Confidence calibration
    conf_str = f"{thesis.confidence:.0%}" if thesis.confidence is not None else "N/A"
    adj = evidence_bag.get("confidence_adjustment_reason") or ""
    if adj:
        lines.append(f"  Confidence:    {conf_str} — {adj[:80]}")
    else:
        lines.append(f"  Confidence:    {conf_str}")
    # 6. Monitor next
    if thesis.risk_notes:
        lines.append(f"  Monitor:       {thesis.risk_notes[0][:80]}")
    elif thesis.contradictions:
        lines.append(f"  Monitor:       {thesis.contradictions[0][:80]}")
    else:
        lines.append("  Monitor:       review scenarios & watchlist")

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


@thesis_app.command("scenarios")
def thesis_scenarios(
    thesis_id: str = typer.Argument(..., help="Trade thesis id."),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=100),
):
    """Show structured scenarios attached to a thesis."""
    service = _service()
    if not service.get_thesis(thesis_id):
        console.print(f"[red]Thesis not found:[/red] {thesis_id}")
        raise typer.Exit(1)

    scenarios = service.list_scenarios(thesis_id=thesis_id, limit=limit)
    if not scenarios:
        console.print("[yellow]No scenarios saved for this thesis yet.[/yellow]")
        return

    table = Table(title=f"Thesis Scenarios: {thesis_id}")
    table.add_column("Probability")
    table.add_column("Condition")
    table.add_column("Expected Behavior")
    table.add_column("Invalidation")
    table.add_column("Action")
    for scenario in scenarios:
        table.add_row(
            scenario.probability_band.value,
            scenario.condition,
            scenario.expected_market_behavior,
            scenario.invalidation or "N/A",
            scenario.suggested_user_action,
        )
    console.print(table)

    for scenario in scenarios:
        if scenario.risk_map:
            lines = [f"- {risk}" for risk in scenario.risk_map]
            console.print(
                Panel(
                    "\n".join(lines),
                    title=f"Risk Map: {scenario.id}",
                    border_style="yellow",
                )
            )


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


def _print_opinions_table(opinions) -> None:
    table = Table(title="Agent Opinions")
    table.add_column("Agent")
    table.add_column("Role")
    table.add_column("Stance")
    table.add_column("Confidence")
    table.add_column("Evidence")
    table.add_column("Missing Data")
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
            "\n".join(opinion.missing_data[:2]),
        )
    console.print(table)


def _fmt_pct(value: float | None) -> str:
    return f"{value:.0%}" if value is not None else "N/A"


def _fmt_number(value: float | None) -> str:
    return f"{value:.4f}" if value is not None else "N/A"


def register_journal(parent_app: typer.Typer) -> None:
    """Mount journal and thesis command groups on the main CLI app."""
    parent_app.add_typer(journal_app, name="journal")
    parent_app.add_typer(thesis_app, name="thesis")
