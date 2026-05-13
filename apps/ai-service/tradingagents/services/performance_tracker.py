"""Performance tracker — auto-evaluation, trending, and degradation detection.

Wraps ``EvaluationService`` to provide time-based performance measurement
and alerting so operators know when prediction quality is declining.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from typing import Any

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain.trending import HealthReport, TrendPoint

logger = logging.getLogger(__name__)


DEFAULT_MIN_PERFORMANCE_SAMPLE_SIZE = 30
DEFAULT_MIN_OUT_OF_SAMPLE_SIZE = 10


class PerformanceTracker:
    """Tracks prediction quality over time using the evaluation journal."""

    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or DEFAULT_CONFIG
        self._eval_svc = None
        self._journal_svc = None

    @property
    def eval_svc(self):
        if self._eval_svc is None:
            from tradingagents.services.evaluation_service import EvaluationService

            self._eval_svc = EvaluationService(self.config)
        return self._eval_svc

    @property
    def journal_svc(self):
        if self._journal_svc is None:
            from tradingagents.services.journal_service import JournalService

            self._journal_svc = JournalService(self.config)
        return self._journal_svc

    # ------------------------------------------------------------------
    # Auto-evaluation
    # ------------------------------------------------------------------

    def evaluate_matured_theses(
        self, *, window_days: int = 14, max_batch: int = 10
    ) -> int:
        """Evaluate theses older than *window_days* that lack an evaluation.

        Best-effort: individual failures are logged and skipped.
        Returns the number of new evaluations created.
        """
        eval_cfg = self.config.get("evaluation", {})
        if not eval_cfg.get("auto_evaluate_enabled", True):
            return 0

        window_days = eval_cfg.get("window_days", window_days)
        config_max = eval_cfg.get("auto_evaluate_max_batch", max_batch)
        max_batch = min(max_batch, config_max)
        cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

        try:
            theses = self.journal_svc.list_theses(limit=200)
        except Exception as exc:
            logger.debug("Cannot list theses for auto-evaluation: %s", exc)
            return 0

        evaluated_ids: set[str] = set()
        try:
            existing = self.eval_svc.list_evaluations(limit=500)
            evaluated_ids = {e.thesis_id for e in existing}
        except Exception as exc:
            logger.debug("Cannot list existing evaluations: %s", exc)

        count = 0
        for thesis in theses:
            if count >= max_batch:
                break
            if not thesis.id or thesis.id in evaluated_ids:
                continue
            if not thesis.created_at:
                continue
            c_at = thesis.created_at
            if hasattr(c_at, "tzinfo") and c_at.tzinfo is None:
                c_at = c_at.replace(tzinfo=timezone.utc)
            if c_at > cutoff:
                continue

            try:
                self.eval_svc.evaluate_thesis(thesis.id, window_days=window_days)
                count += 1
            except Exception as exc:
                logger.debug(
                    "Auto-evaluation skipped for thesis %s: %s", thesis.id, exc
                )

        if count:
            logger.info("Auto-evaluated %d matured theses.", count)
        return count

    # ------------------------------------------------------------------
    # Trending
    # ------------------------------------------------------------------

    def get_trend(self, *, days: int = 90) -> list[TrendPoint]:
        """Return weekly performance trend over the last *days*.

        Each ``TrendPoint`` buckets theses by their creation week.
        """
        try:
            evaluations = self.eval_svc.list_evaluations(limit=500)
        except Exception:
            return []

        cutoff = date.today() - timedelta(days=days)

        # Group evaluations by thesis creation week
        week_evals: dict[str, list] = defaultdict(list)
        for ev in evaluations:
            thesis = self._get_thesis(ev.thesis_id)
            if thesis is None or thesis.created_at is None:
                continue
            c_date = thesis.created_at.date()
            if c_date < cutoff:
                continue
            week_start = c_date - timedelta(days=c_date.weekday())
            key = week_start.isoformat()
            week_evals[key].append(ev)

        points: list[TrendPoint] = []
        for key in sorted(week_evals.keys()):
            evals = week_evals[key]
            sample = len(evals)
            hits = sum(1 for e in evals if e.result.value == "hit_target")
            mfe_vals = [
                e.max_favorable_excursion
                for e in evals
                if e.max_favorable_excursion is not None
            ]
            mae_vals = [
                e.max_adverse_excursion
                for e in evals
                if e.max_adverse_excursion is not None
            ]
            points.append(
                TrendPoint(
                    week_start=date.fromisoformat(key),
                    sample_size=sample,
                    hit_rate=hits / sample if sample else None,
                    avg_mfe=sum(mfe_vals) / len(mfe_vals) if mfe_vals else None,
                    avg_mae=sum(mae_vals) / len(mae_vals) if mae_vals else None,
                    calibration_quality="insufficient_data",
                )
            )

        return points

    # ------------------------------------------------------------------
    # Degradation detection
    # ------------------------------------------------------------------

    def detect_degradation(
        self, *, recent_days: int = 14, baseline_days: int = 60
    ) -> HealthReport:
        """Compare recent vs baseline performance and flag degradation."""
        eval_cfg = self.config.get("evaluation", {})
        degradation_threshold = eval_cfg.get("degradation_threshold", 0.20)
        critical_threshold = eval_cfg.get("critical_threshold", 0.40)

        try:
            evaluations = self.eval_svc.list_evaluations(limit=500)
        except Exception:
            return HealthReport(
                overall_status="insufficient_data",
                recommendation="Cannot load evaluations. Check journal database.",
            )

        min_sample = int(
            eval_cfg.get(
                "min_performance_sample_size",
                DEFAULT_MIN_PERFORMANCE_SAMPLE_SIZE,
            )
        )
        min_oos = int(
            eval_cfg.get("min_out_of_sample_size", DEFAULT_MIN_OUT_OF_SAMPLE_SIZE)
        )
        if len(evaluations) < min_sample:
            return HealthReport(
                overall_status="insufficient_data",
                recommendation=(
                    f"Need at least {min_sample} evaluated theses and {min_oos} "
                    f"out-of-sample windows for health check. Currently have "
                    f"{len(evaluations)}."
                ),
            )

        recent_cutoff = date.today() - timedelta(days=recent_days)
        baseline_cutoff = date.today() - timedelta(days=baseline_days)

        recent: list = []
        baseline: list = []
        for ev in evaluations:
            thesis = self._get_thesis(ev.thesis_id)
            if thesis is None or thesis.created_at is None:
                continue
            c_date = thesis.created_at.date()
            if c_date >= recent_cutoff:
                recent.append(ev)
            elif c_date >= baseline_cutoff:
                baseline.append(ev)

        recent_hits = sum(1 for e in recent if e.result.value == "hit_target")
        recent_rate = recent_hits / len(recent) if recent else None
        baseline_hits = sum(1 for e in baseline if e.result.value == "hit_target")
        baseline_rate = baseline_hits / len(baseline) if baseline else None

        alerts: list[str] = []
        status = "healthy"
        recommendation = "Performance is stable."

        if recent_rate is not None and baseline_rate is not None and baseline_rate > 0:
            drop = (baseline_rate - recent_rate) / baseline_rate
            if drop >= critical_threshold:
                status = "critical"
                alerts.append(
                    f"Critical: hit rate dropped {drop:.0%} "
                    f"({baseline_rate:.0%} → {recent_rate:.0%}) over {recent_days} days."
                )
                recommendation = (
                    "Performance has degraded significantly. "
                    "Review recent theses for systematic errors, "
                    "check data provider health, and consider model/provider changes."
                )
            elif drop >= degradation_threshold:
                status = "degraded"
                alerts.append(
                    f"Warning: hit rate dropped {drop:.0%} "
                    f"({baseline_rate:.0%} → {recent_rate:.0%}) over {recent_days} days."
                )
                recommendation = (
                    "Monitor closely. If degradation continues, "
                    "review data freshness and model configuration."
                )

        if recent_rate is not None and recent_rate < 0.25:
            if status == "healthy":
                status = "degraded"
            alerts.append(
                f"Recent hit rate is below 25% ({recent_rate:.0%}) — "
                "less predictive than a coin flip."
            )

        if not recent and not baseline:
            return HealthReport(
                overall_status="insufficient_data",
                recommendation="No evaluations found in the time windows.",
            )

        return HealthReport(
            overall_status=status,
            recent_sample_size=len(recent),
            baseline_sample_size=len(baseline),
            recent_hit_rate=recent_rate,
            baseline_hit_rate=baseline_rate,
            alerts=alerts,
            recommendation=recommendation,
        )

    # ------------------------------------------------------------------
    # Feedback context for agent prompts
    # ------------------------------------------------------------------

    def build_feedback_context(self) -> str:
        """Build a concise markdown block summarising current performance.

        Injected into the Portfolio Manager prompt so the system sees its
        own historical accuracy when making new decisions.
        """
        eval_cfg = self.config.get("evaluation", {})
        if not eval_cfg.get("feedback_enabled", True):
            return ""

        try:
            analytics = self.eval_svc.build_analytics(limit=200)
            curve = self.eval_svc.build_confidence_curve(limit=200)
        except Exception:
            return ""

        overall = analytics.overall
        min_sample = int(
            eval_cfg.get(
                "min_performance_sample_size",
                DEFAULT_MIN_PERFORMANCE_SAMPLE_SIZE,
            )
        )
        min_oos = int(
            eval_cfg.get("min_out_of_sample_size", DEFAULT_MIN_OUT_OF_SAMPLE_SIZE)
        )
        oos_sample = overall.sample_size
        if overall.sample_size < min_sample or oos_sample < min_oos:
            return ""

        lines = [
            "## Empirical Calibration Context",
            "",
            (
                f"The system has evaluated **{overall.sample_size}** "
                "forward-window theses. Treat these as empirical calibration, "
                "not live trading performance."
            ),
            (
                f"Minimum publication gate: n>={min_sample}, "
                f"out-of-sample>={min_oos}; current out-of-sample n={oos_sample}."
            ),
            "",
            "### Out-of-sample quality review",
            f"- Hit rate: {self._pct(overall.hit_rate)}",
            f"- Invalidation rate: {self._pct(overall.invalidation_rate)}",
            f"- Avg favourable excursion: {self._pct(overall.average_mfe)}",
            f"- Avg adverse excursion: {self._pct(overall.average_mae)}",
            "",
            f"### Confidence Calibration: **{curve.calibration_quality}**",
        ]

        if curve.overall_calibration_error is not None:
            direction = (
                "over-confident"
                if curve.overall_calibration_error < 0
                else "under-confident"
            )
            lines.append(
                f"The system is {direction} "
                f"(error: {curve.overall_calibration_error:+.0%})."
            )

        # Add best/worst factors if available
        factor_report = None
        try:
            factor_report = self.eval_svc.build_factor_reliability(limit=200)
        except Exception:
            pass
        if factor_report and factor_report.best_factor:
            lines.append(f"- Most reliable signal: **{factor_report.best_factor}**")
        if factor_report and factor_report.worst_factor:
            lines.append(f"- Least reliable signal: **{factor_report.worst_factor}**")

        lines.append(
            "\nUse this context to calibrate confidence. "
            "If the system has been over-confident, be more conservative. "
            "Give more weight to historically reliable signals.\n"
        )

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _pct(value: float | None) -> str:
        if value is None:
            return "N/A"
        return f"{value:.0%}"

    def _get_thesis(self, thesis_id: str):
        """Load a single thesis, caching lookups."""
        if not hasattr(self, "_thesis_cache"):
            self._thesis_cache: dict[str, object] = {}
        if thesis_id not in self._thesis_cache:
            try:
                self._thesis_cache[thesis_id] = self.journal_svc.get_thesis(thesis_id)
            except Exception:
                self._thesis_cache[thesis_id] = None
        return self._thesis_cache[thesis_id]
