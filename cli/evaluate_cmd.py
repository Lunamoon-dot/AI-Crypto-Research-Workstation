"""CLI commands for historical thesis evaluation (Phase 9).

Bridges the EvaluationService to the terminal so users can score thesis
quality without pretending to run a broker-accurate backtest.

Phase 9E adds factor reliability, agent calibration, confidence curves,
and contradiction analysis commands.

Phase 9F adds auto-evaluation, trend tracking, and health-check commands
via PerformanceTracker.
"""

from __future__ import annotations

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tradingagents.services.evaluation_service import EvaluationService
from tradingagents.services.performance_tracker import PerformanceTracker

from cli.json_emit import print_json_stdout

evaluate_app = typer.Typer(help="Historical thesis evaluation")
console = Console()
EM_DASH = "\u2014"


def _fmt_pct(value: float | None) -> str:
    return f"{value:.0%}" if value is not None else EM_DASH


@evaluate_app.command("thesis")
def evaluate_thesis_cmd(
    thesis_id: str = typer.Argument(..., help="Thesis ID to evaluate"),
    window_days: int = typer.Option(14, "--window", "-w", help="Forward OHLCV window in days"),
    record_review: bool = typer.Option(
        False, "--record-review", help="Auto-record evaluation as an outcome review"
    ),
) -> None:
    """Evaluate one saved thesis over a forward OHLCV window."""
    try:
        svc = EvaluationService()
        evaluation = svc.evaluate_thesis(
            thesis_id,
            window_days=window_days,
            record_review=record_review,
        )
        table = Table(title=f"Thesis Evaluation — {thesis_id}", box=box.SIMPLE)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="white")
        table.add_row("Result", f"[bold]{evaluation.result.value}[/bold]")
        table.add_row("Symbol", evaluation.symbol)
        table.add_row("Window", f"{window_days} day(s)")
        table.add_row("MFE", f"{evaluation.max_favorable_excursion:.2%}" if evaluation.max_favorable_excursion is not None else "\u2014")
        table.add_row("MAE", f"{evaluation.max_adverse_excursion:.2%}" if evaluation.max_adverse_excursion is not None else "\u2014")
        table.add_row("Invalidated", str(evaluation.invalidated))
        console.print(table)
    except ValueError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1)


@evaluate_app.command("batch")
def evaluate_batch_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(20, "--limit", "-n", min=1, max=200),
    window_days: int = typer.Option(14, "--window", "-w", help="Forward OHLCV window in days"),
) -> None:
    """Evaluate multiple saved theses and show a summary table."""
    svc = EvaluationService()
    evaluations = svc.evaluate_batch(symbol=symbol, limit=limit, window_days=window_days)

    table = Table(title=f"Thesis Batch Evaluation ({len(evaluations)} theses)", box=box.SIMPLE)
    table.add_column("Thesis ID", style="cyan", no_wrap=True)
    table.add_column("Symbol", style="green")
    table.add_column("Result", style="bold")
    table.add_column("MFE")
    table.add_column("MAE")
    table.add_column("Invalidated")

    for ev in evaluations:
        result_style = {
            "hit_target": "green",
            "invalidated": "red",
            "mixed": "yellow",
            "expired": "dim",
            "unknown": "dim",
        }.get(ev.result.value, "white")
        table.add_row(
            ev.id or "\u2014",
            ev.symbol,
            f"[{result_style}]{ev.result.value}[/{result_style}]",
            f"{ev.max_favorable_excursion:.2%}" if ev.max_favorable_excursion is not None else "\u2014",
            f"{ev.max_adverse_excursion:.2%}" if ev.max_adverse_excursion is not None else "\u2014",
            "\u2713" if ev.invalidated else "\u2014",
        )
    console.print(table)


@evaluate_app.command("list")
def evaluate_list_cmd(
    thesis_id: str = typer.Option(None, "--thesis-id", help="Filter by thesis ID"),
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(100, "--limit", "-n", min=1, max=500),
) -> None:
    """List previously saved thesis evaluations."""
    svc = EvaluationService()
    evaluations = svc.list_evaluations(thesis_id=thesis_id, symbol=symbol, limit=limit)

    table = Table(title=f"Saved Evaluations ({len(evaluations)})", box=box.SIMPLE)
    table.add_column("Eval ID", style="dim", no_wrap=True)
    table.add_column("Thesis ID", style="cyan", no_wrap=True)
    table.add_column("Symbol", style="green")
    table.add_column("Result", style="bold")
    table.add_column("Window")

    for ev in evaluations:
        result_style = {
            "hit_target": "green",
            "invalidated": "red",
        }.get(ev.result.value, "white")
        table.add_row(
            ev.id or "\u2014",
            ev.thesis_id,
            ev.symbol,
            f"[{result_style}]{ev.result.value}[/{result_style}]",
            f"{ev.window_days}d" if ev.window_days else "\u2014",
        )
    console.print(table)


@evaluate_app.command("analytics")
def evaluate_analytics_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(100, "--limit", "-n", min=1, max=500),
    json_out: bool = typer.Option(False, "--json", help="Emit analytics as JSON."),
) -> None:
    """Show aggregate analytics across evaluated theses."""
    svc = EvaluationService()
    analytics = svc.build_analytics(symbol=symbol, limit=limit)
    overall = analytics.overall

    if json_out:
        print_json_stdout({"analytics": analytics.model_dump(mode="json")})
        return

    console.print(
        Panel(
            f"Sample size: [bold]{analytics.total_sample_size}[/bold] theses",
            title="Evaluation Analytics",
            border_style="cyan",
        )
    )

    table = Table(box=box.SIMPLE)
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="bold")

    table.add_row("Hit rate", _fmt_pct(overall.hit_rate))
    table.add_row("Invalidation rate", _fmt_pct(overall.invalidation_rate))
    table.add_row("Mixed rate", _fmt_pct(overall.mixed_rate))
    table.add_row("Expired rate", _fmt_pct(overall.expired_rate))
    table.add_row("Avg MFE", f"{overall.average_mfe:.2%}" if overall.average_mfe is not None else "\u2014")
    table.add_row("Avg MAE", f"{overall.average_mae:.2%}" if overall.average_mae is not None else "\u2014")
    console.print(table)


# ---------------------------------------------------------------------------
# Phase 9E: Agent & signal reliability commands
# ---------------------------------------------------------------------------


@evaluate_app.command("factors")
def evaluate_factors_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(300, "--limit", "-n", min=1, max=500),
) -> None:
    """Show per-factor signal reliability — hit rate per factor."""
    svc = EvaluationService()
    report = svc.build_factor_reliability(symbol=symbol, limit=limit)

    console.print(
        Panel(
            f"Sample: [bold]{report.total_sample_size}[/bold] evaluations\n"
            f"Best factor: [green]{report.best_factor or EM_DASH}[/green]  "
            f"Worst factor: [red]{report.worst_factor or EM_DASH}[/red]",
            title="Factor Reliability",
            border_style="cyan",
        )
    )

    table = Table(box=box.SIMPLE)
    table.add_column("Factor", style="cyan")
    table.add_column("N", style="dim")
    table.add_column("Hit Rate", style="bold")
    table.add_column("Dir Accuracy")
    table.add_column("Strong Hit")
    table.add_column("Avg Conf")

    for f in report.factors:
        table.add_row(
            f.factor_name,
            str(f.sample_size),
            _fmt_pct(f.hit_rate),
            _fmt_pct(f.directional_accuracy),
            _fmt_pct(f.strong_signal_hit_rate),
            f"{f.average_confidence:.0%}" if f.average_confidence is not None else "\u2014",
        )
    console.print(table)


@evaluate_app.command("agents")
def evaluate_agents_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(300, "--limit", "-n", min=1, max=500),
) -> None:
    """Show agent stance calibration — how reliable is each agent?"""
    svc = EvaluationService()
    report = svc.build_agent_calibration(symbol=symbol, limit=limit)

    console.print(
        Panel(
            f"Sample: [bold]{report.total_sample_size}[/bold] evaluations\n"
            f"Most accurate: [green]{report.most_accurate_agent or EM_DASH}[/green]  "
            f"Most biased: [yellow]{report.most_biased_agent or EM_DASH}[/yellow]",
            title="Agent Calibration",
            border_style="cyan",
        )
    )

    table = Table(box=box.SIMPLE)
    table.add_column("Agent", style="cyan")
    table.add_column("Role", style="dim")
    table.add_column("N")
    table.add_column("Bull%", style="green")
    table.add_column("Bear%", style="red")
    table.add_column("Accuracy", style="bold")
    table.add_column("Bias")

    for a in report.agents:
        bias_color = "green" if (a.bias_score or 0) > 0.3 else ("red" if (a.bias_score or 0) < -0.3 else "white")
        table.add_row(
            a.agent_name,
            a.role,
            str(a.sample_size),
            _fmt_pct(a.bullish_rate),
            _fmt_pct(a.bearish_rate),
            _fmt_pct(a.stance_accuracy),
            f"[{bias_color}]{a.bias_score:+.2f}[/{bias_color}]" if a.bias_score is not None else "\u2014",
        )
    console.print(table)


@evaluate_app.command("confidence")
def evaluate_confidence_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(300, "--limit", "-n", min=1, max=500),
) -> None:
    """Show confidence calibration curve — is the system well-calibrated?"""
    svc = EvaluationService()
    curve = svc.build_confidence_curve(symbol=symbol, limit=limit)

    quality_color = {
        "well_calibrated": "green",
        "under_confident": "yellow",
        "over_confident": "red",
        "insufficient_data": "dim",
    }.get(curve.calibration_quality, "white")

    err_text = f"Overall error: {curve.overall_calibration_error:+.2%}" if curve.overall_calibration_error is not None else "Overall error: \u2014"

    console.print(
        Panel(
            f"Quality: [bold {quality_color}]{curve.calibration_quality}[/bold {quality_color}]\n{err_text}",
            title="Confidence Calibration Curve",
            border_style="cyan",
        )
    )

    table = Table(box=box.SIMPLE)
    table.add_column("Bucket", style="cyan")
    table.add_column("N", style="dim")
    table.add_column("Expected", style="dim")
    table.add_column("Actual", style="bold")
    table.add_column("Error")

    for b in curve.buckets:
        err_color = "green" if (b.calibration_error or 0) >= -0.05 else ("red" if (b.calibration_error or 0) < -0.10 else "yellow")
        table.add_row(
            b.bucket_label,
            str(b.sample_size),
            _fmt_pct(b.expected_rate),
            _fmt_pct(b.hit_rate),
            f"[{err_color}]{b.calibration_error:+.0%}[/{err_color}]" if b.calibration_error is not None else "\u2014",
        )
    console.print(table)


@evaluate_app.command("contradictions")
def evaluate_contradictions_cmd(
    symbol: str = typer.Option(None, "--symbol", "-s", help="Filter by symbol"),
    limit: int = typer.Option(300, "--limit", "-n", min=1, max=500),
) -> None:
    """Analyze whether agent disagreements help or hurt outcomes."""
    svc = EvaluationService()
    analysis = svc.build_contradiction_analysis(symbol=symbol, limit=limit)

    usefulness_color = {
        "helpful": "green",
        "harmful": "red",
        "neutral": "yellow",
        "insufficient_data": "dim",
    }.get(analysis.contradiction_usefulness, "white")

    avg_text = f"Sample: {analysis.sample_size} | Avg contradictions: {analysis.contradiction_count_avg:.1f}" if analysis.contradiction_count_avg is not None else f"Sample: {analysis.sample_size}"

    console.print(
        Panel(
            f"Contradiction usefulness: [bold {usefulness_color}]{analysis.contradiction_usefulness}[/bold {usefulness_color}]\n{avg_text}",
            title="Contradiction Analysis",
            border_style="cyan",
        )
    )

    # Conflict level table
    table = Table(title="By Conflict Level", box=box.SIMPLE)
    table.add_column("Conflict", style="cyan")
    table.add_column("N", style="dim")
    table.add_column("Hit Rate", style="bold")
    table.add_row("Low", str(analysis.low_conflict_sample), _fmt_pct(analysis.low_conflict_hit_rate))
    table.add_row("Medium", str(analysis.medium_conflict_sample), _fmt_pct(analysis.medium_conflict_hit_rate))
    table.add_row("High", str(analysis.high_conflict_sample), _fmt_pct(analysis.high_conflict_hit_rate))
    console.print(table)

    # Contradiction count table
    table2 = Table(title="By Contradiction Count", box=box.SIMPLE)
    table2.add_column("Group", style="cyan")
    table2.add_column("Hit Rate", style="bold")
    table2.add_row("No contradictions", _fmt_pct(analysis.no_contradiction_hit_rate))
    contra_label = f"\u2265{analysis.contradiction_count_avg:.1f} contradictions" if analysis.contradiction_count_avg else "Above avg contradictions"
    table2.add_row(contra_label, _fmt_pct(analysis.contradiction_hit_rate))
    console.print(table2)

    # Stance diversity table
    table3 = Table(title="By Stance Diversity", box=box.SIMPLE)
    table3.add_column("Group", style="cyan")
    table3.add_column("Hit Rate", style="bold")
    table3.add_row("High diversity (disagree)", _fmt_pct(analysis.high_diversity_hit_rate))
    table3.add_row("Low diversity (consensus)", _fmt_pct(analysis.low_diversity_hit_rate))
    console.print(table3)


# ---------------------------------------------------------------------------
# Phase 9F: Auto-evaluation, trending, and health-check commands
# ---------------------------------------------------------------------------


@evaluate_app.command("matured")
def evaluate_matured_cmd(
    window_days: int = typer.Option(14, "--window", "-w", help="Forward OHLCV window in days"),
    max_batch: int = typer.Option(10, "--max", "-n", min=1, max=50, help="Max theses to evaluate"),
) -> None:
    """Evaluate all matured theses that lack an evaluation."""
    tracker = PerformanceTracker()
    count = tracker.evaluate_matured_theses(window_days=window_days, max_batch=max_batch)
    if count:
        console.print(f"[green]Evaluated {count} matured thesis(es).[/green]")
    else:
        console.print("[dim]No matured theses need evaluation right now.[/dim]")


@evaluate_app.command("trend")
def evaluate_trend_cmd(
    days: int = typer.Option(90, "--days", "-d", min=7, max=365, help="Lookback in days"),
) -> None:
    """Show weekly performance trend over time."""
    tracker = PerformanceTracker()
    points = tracker.get_trend(days=days)

    if not points:
        console.print("[dim]No evaluations found in the last {days} days.[/dim]")
        return

    table = Table(
        title=f"Performance Trend — last {days} days ({len(points)} weeks)",
        box=box.SIMPLE,
    )
    table.add_column("Week Starting", style="cyan")
    table.add_column("N", style="dim")
    table.add_column("Hit Rate", style="bold")
    table.add_column("Avg MFE")
    table.add_column("Avg MAE")

    for point in points:
        hit_style = "green" if (point.hit_rate or 0) >= 0.5 else ("red" if (point.hit_rate or 0) < 0.3 else "yellow")
        table.add_row(
            point.week_start.isoformat(),
            str(point.sample_size),
            f"[{hit_style}]{_fmt_pct(point.hit_rate)}[/{hit_style}]",
            _fmt_pct(point.avg_mfe),
            _fmt_pct(point.avg_mae),
        )
    console.print(table)


@evaluate_app.command("health")
def evaluate_health_cmd(
    recent_days: int = typer.Option(14, "--recent-days", min=7, max=90, help="Recent window in days"),
    baseline_days: int = typer.Option(60, "--baseline-days", min=14, max=365, help="Baseline window in days"),
    json_out: bool = typer.Option(False, "--json", help="Emit health report as JSON."),
) -> None:
    """Quick health check — detect performance degradation."""
    tracker = PerformanceTracker()
    report = tracker.detect_degradation(recent_days=recent_days, baseline_days=baseline_days)

    if json_out:
        print_json_stdout({"health": report.model_dump(mode="json")})
        return

    status_color = {
        "healthy": "green",
        "degraded": "yellow",
        "critical": "red",
        "insufficient_data": "dim",
    }.get(report.overall_status, "white")

    lines = [
        f"Status: [bold {status_color}]{report.overall_status.upper()}[/bold {status_color}]",
        "",
        f"Recent ({recent_days}d): {report.recent_sample_size} theses"
        + (
            f" — hit rate: {report.recent_hit_rate:.0%}"
            if report.recent_hit_rate is not None
            else ""
        ),
        f"Baseline ({baseline_days}d): {report.baseline_sample_size} theses"
        + (
            f" — hit rate: {report.baseline_hit_rate:.0%}"
            if report.baseline_hit_rate is not None
            else ""
        ),
    ]

    if report.alerts:
        lines.append("")
        lines.append("[bold]Alerts:[/bold]")
        for alert in report.alerts:
            lines.append(f"  [yellow]⚠[/yellow] {alert}")

    if report.recommendation:
        lines.append("")
        lines.append(f"[bold]Recommendation:[/bold] {report.recommendation}")

    console.print(
        Panel(
            "\n".join(lines),
            title="Performance Health Check",
            border_style=status_color,
        )
    )
