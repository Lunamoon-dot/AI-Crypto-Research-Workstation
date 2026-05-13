"""Tests for PerformanceTracker — auto-evaluation, trending, degradation detection."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock


from tradingagents.domain.trending import HealthReport, TrendPoint
from tradingagents.domain.evaluation import (
    EvaluationAnalytics,
    EvaluationMetricsRow,
    ThesisEvaluation,
)
from tradingagents.domain.outcome import OutcomeResult


# ---------------------------------------------------------------------------
# Domain model tests
# ---------------------------------------------------------------------------


class TestTrendPoint:
    def test_defaults(self):
        point = TrendPoint(week_start=date.today())
        assert point.sample_size == 0
        assert point.hit_rate is None
        assert point.calibration_quality == "insufficient_data"

    def test_with_data(self):
        point = TrendPoint(
            week_start=date(2025, 1, 6),
            sample_size=10,
            hit_rate=0.6,
            avg_mfe=0.12,
            avg_mae=-0.05,
        )
        assert point.hit_rate == 0.6
        assert point.avg_mfe == 0.12


class TestHealthReport:
    def test_defaults(self):
        report = HealthReport()
        assert report.overall_status == "insufficient_data"
        assert report.alerts == []
        assert report.recent_sample_size == 0

    def test_critical(self):
        report = HealthReport(
            overall_status="critical",
            recent_sample_size=5,
            baseline_sample_size=40,
            recent_hit_rate=0.2,
            baseline_hit_rate=0.5,
            alerts=["Hit rate dropped 60%"],
            recommendation="Review model configuration.",
        )
        assert report.overall_status == "critical"
        assert len(report.alerts) == 1
        assert report.recent_hit_rate == 0.2

    def test_json_roundtrip(self):
        report = HealthReport(
            overall_status="healthy",
            recent_sample_size=10,
            baseline_sample_size=50,
            recent_hit_rate=0.55,
            baseline_hit_rate=0.50,
        )
        data = report.model_dump(mode="json")
        reloaded = HealthReport(**data)
        assert reloaded.overall_status == "healthy"
        assert reloaded.recent_hit_rate == 0.55


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tracker(eval_svc=None, journal_svc=None):
    """Create a PerformanceTracker with pre-set mocked service attributes."""
    from tradingagents.services.performance_tracker import PerformanceTracker

    tracker = PerformanceTracker()
    tracker._eval_svc = eval_svc or MagicMock()
    tracker._journal_svc = journal_svc or MagicMock()
    return tracker


def _make_thesis(thesis_id, symbol="BTC/USDT", days_ago=30):
    from tradingagents.domain.thesis import TradeThesis, ThesisDirection

    return TradeThesis(
        id=thesis_id,
        symbol=symbol,
        direction=ThesisDirection.LONG,
        thesis_text="test thesis",
        created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


def _make_eval(
    thesis_id, symbol="BTC/USDT", result=OutcomeResult.HIT_TARGET, mfe=0.10, mae=-0.03
):
    today = date.today()
    return ThesisEvaluation(
        thesis_id=thesis_id,
        symbol=symbol,
        evaluation_start=today,
        evaluation_end=today + timedelta(days=14),
        window_days=14,
        result=result,
        max_favorable_excursion=mfe,
        max_adverse_excursion=mae,
    )


# ---------------------------------------------------------------------------
# Evaluate matured theses
# ---------------------------------------------------------------------------


class TestEvaluateMaturedTheses:
    def test_no_theses_returns_zero(self):
        tracker = _make_tracker()
        tracker._journal_svc.list_theses.return_value = []
        tracker._eval_svc.list_evaluations.return_value = []
        assert tracker.evaluate_matured_theses() == 0

    def test_skips_already_evaluated(self):
        thesis = _make_thesis("thesis-1")
        tracker = _make_tracker()
        tracker._journal_svc.list_theses.return_value = [thesis]
        tracker._eval_svc.list_evaluations.return_value = [_make_eval("thesis-1")]
        assert tracker.evaluate_matured_theses() == 0

    def test_skips_recent_theses(self):
        thesis = _make_thesis("thesis-2", days_ago=3)
        tracker = _make_tracker()
        tracker._journal_svc.list_theses.return_value = [thesis]
        tracker._eval_svc.list_evaluations.return_value = []
        assert tracker.evaluate_matured_theses(window_days=14) == 0

    def test_evaluates_matured_unevaluated(self):
        thesis = _make_thesis("thesis-3")
        tracker = _make_tracker()
        tracker._journal_svc.list_theses.return_value = [thesis]
        tracker._eval_svc.list_evaluations.return_value = []
        tracker._eval_svc.evaluate_thesis.return_value = _make_eval("thesis-3")

        count = tracker.evaluate_matured_theses()
        assert count == 1
        tracker._eval_svc.evaluate_thesis.assert_called_once()

    def test_respects_max_batch(self):
        theses = [_make_thesis(f"thesis-{i}") for i in range(10)]
        tracker = _make_tracker()
        tracker._journal_svc.list_theses.return_value = theses
        tracker._eval_svc.list_evaluations.return_value = []

        count = tracker.evaluate_matured_theses(max_batch=3)
        assert count == 3
        assert tracker._eval_svc.evaluate_thesis.call_count == 3

    def test_disabled_via_config(self):
        from tradingagents.services.performance_tracker import PerformanceTracker

        config = {"evaluation": {"auto_evaluate_enabled": False}}
        tracker = PerformanceTracker(config)
        assert tracker.evaluate_matured_theses() == 0


# ---------------------------------------------------------------------------
# Trending
# ---------------------------------------------------------------------------


class TestGetTrend:
    def test_empty_returns_empty_list(self):
        tracker = _make_tracker()
        tracker._eval_svc.list_evaluations.return_value = []
        assert tracker.get_trend() == []

    def test_groups_by_week(self):
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        thesis_date = datetime(
            monday.year, monday.month, monday.day, tzinfo=timezone.utc
        )

        thesis = _make_thesis("t1")
        thesis.created_at = thesis_date

        tracker = _make_tracker()
        tracker._eval_svc.list_evaluations.return_value = [
            _make_eval("t1", mfe=0.10, mae=-0.03)
        ]
        tracker._journal_svc.get_thesis.return_value = thesis

        points = tracker.get_trend(days=90)
        assert len(points) == 1
        assert points[0].sample_size == 1
        assert points[0].hit_rate == 1.0
        assert points[0].avg_mfe == 0.10
        assert points[0].avg_mae == -0.03


# ---------------------------------------------------------------------------
# Degradation detection
# ---------------------------------------------------------------------------


class TestDetectDegradation:
    def test_insufficient_data_with_few_evaluations(self):
        tracker = _make_tracker()
        tracker._eval_svc.list_evaluations.return_value = []
        report = tracker.detect_degradation()
        assert report.overall_status == "insufficient_data"

    def test_healthy_when_stable(self):
        recent = datetime.now(timezone.utc) - timedelta(days=7)
        baseline = datetime.now(timezone.utc) - timedelta(days=30)

        evaluations = []
        theses = {}
        # Recent: 5 hits / 10 = 50%
        for i in range(10):
            tid = f"r{i}"
            result = OutcomeResult.HIT_TARGET if i < 5 else OutcomeResult.INVALIDATED
            evaluations.append(_make_eval(tid, result=result))
            t = _make_thesis(tid)
            t.created_at = recent
            theses[tid] = t
        # Baseline: 13 hits / 25 = 52%
        for i in range(25):
            tid = f"b{i}"
            result = OutcomeResult.HIT_TARGET if i < 13 else OutcomeResult.INVALIDATED
            evaluations.append(_make_eval(tid, result=result))
            t = _make_thesis(tid)
            t.created_at = baseline
            theses[tid] = t

        tracker = _make_tracker()
        tracker._eval_svc.list_evaluations.return_value = evaluations
        tracker._journal_svc.get_thesis.side_effect = lambda tid: theses.get(tid)

        report = tracker.detect_degradation(recent_days=14, baseline_days=60)
        assert report.overall_status == "healthy"

    def test_degraded_when_drop_exceeds_threshold(self):
        recent = datetime.now(timezone.utc) - timedelta(days=7)
        baseline = datetime.now(timezone.utc) - timedelta(days=30)

        evaluations = []
        theses = {}
        # Recent: 2 hits / 10 = 20%
        for i in range(10):
            tid = f"r{i}"
            result = OutcomeResult.HIT_TARGET if i < 2 else OutcomeResult.INVALIDATED
            evaluations.append(_make_eval(tid, result=result))
            t = _make_thesis(tid)
            t.created_at = recent
            theses[tid] = t
        # Baseline: 12 hits / 20 = 60%
        for i in range(20):
            tid = f"b{i}"
            result = OutcomeResult.HIT_TARGET if i < 12 else OutcomeResult.INVALIDATED
            evaluations.append(_make_eval(tid, result=result))
            t = _make_thesis(tid)
            t.created_at = baseline
            theses[tid] = t

        tracker = _make_tracker()
        tracker._eval_svc.list_evaluations.return_value = evaluations
        tracker._journal_svc.get_thesis.side_effect = lambda tid: theses.get(tid)

        report = tracker.detect_degradation(recent_days=14, baseline_days=60)
        # 60% -> 20% is 67% relative drop, exceeds critical_threshold 40%
        assert report.overall_status in ("degraded", "critical")
        assert len(report.alerts) >= 1


# ---------------------------------------------------------------------------
# Feedback context
# ---------------------------------------------------------------------------


class TestBuildFeedbackContext:
    def test_returns_empty_when_disabled(self):
        from tradingagents.services.performance_tracker import PerformanceTracker

        config = {"evaluation": {"feedback_enabled": False}}
        tracker = PerformanceTracker(config)
        assert tracker.build_feedback_context() == ""

    def test_returns_empty_when_few_evaluations(self):
        tracker = _make_tracker()
        tracker._eval_svc.build_analytics.return_value = EvaluationAnalytics(
            total_sample_size=2,
            overall=EvaluationMetricsRow(key="overall", sample_size=2),
        )
        tracker._eval_svc.build_confidence_curve.return_value = MagicMock(
            calibration_quality="insufficient_data",
            overall_calibration_error=None,
        )
        assert tracker.build_feedback_context() == ""

    def test_returns_markdown_when_sufficient(self):
        tracker = _make_tracker()
        tracker._eval_svc.build_analytics.return_value = EvaluationAnalytics(
            total_sample_size=30,
            overall=EvaluationMetricsRow(
                key="overall",
                sample_size=30,
                hit_rate=0.55,
                invalidation_rate=0.30,
                average_mfe=0.12,
                average_mae=-0.06,
            ),
        )
        tracker._eval_svc.build_confidence_curve.return_value = MagicMock(
            calibration_quality="well_calibrated",
            overall_calibration_error=-0.02,
        )
        tracker._eval_svc.build_factor_reliability.return_value = MagicMock(
            best_factor="rsi_divergence",
            worst_factor="macd",
        )

        ctx = tracker.build_feedback_context()
        assert "Empirical Calibration Context" in ctx
        assert "not live trading performance" in ctx
        assert "55%" in ctx
        assert "well_calibrated" in ctx
        assert "rsi_divergence" in ctx


# ---------------------------------------------------------------------------
# CLI command smoke tests
# ---------------------------------------------------------------------------


class TestEvaluateMaturedCli:
    def test_matured_command_registered(self):
        from cli.evaluate_cmd import evaluate_app

        commands = [cmd.name for cmd in evaluate_app.registered_commands]
        assert "matured" in commands

    def test_trend_command_registered(self):
        from cli.evaluate_cmd import evaluate_app

        commands = [cmd.name for cmd in evaluate_app.registered_commands]
        assert "trend" in commands

    def test_health_command_registered(self):
        from cli.evaluate_cmd import evaluate_app

        commands = [cmd.name for cmd in evaluate_app.registered_commands]
        assert "health" in commands
