"""Best-effort journal persistence bridge for graph runs."""

from __future__ import annotations

import logging

from tradingagents.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    Scenario,
    ScenarioProbabilityBand,
    Signal,
    TradeThesis,
)
from tradingagents.observability import log_event
from tradingagents.services import JournalService
from tradingagents.signals.base import SignalResult
from tradingagents.signals.snapshots import build_market_snapshot, build_signal_snapshot
from tradingagents.signals.provenance import (
    signal_result_to_domain_signals,
)
from tradingagents.agents.schemas import ScenarioPlan
from tradingagents.graph.opinions import build_agent_opinions, build_research_debate

logger = logging.getLogger(__name__)


class JournalBridge:
    """Keeps journal persistence out of graph orchestration code."""

    def __init__(self, config: dict):
        self.service = None
        self.config = config
        # Track persistence health so we can surface silent data loss.
        self._persist_attempts: int = 0
        self._persist_failures: int = 0
        if config.get("journal", {}).get("enabled", True):
            try:
                self.service = JournalService(config)
            except Exception as e:
                logger.warning("Decision journal disabled: %s", e)
                log_event(
                    logger,
                    "storage_operation_failed",
                    operation="journal_init",
                    error_type=type(e).__name__,
                    error=str(e)[:500],
                )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _record_persist_attempt(self, *, success: bool) -> None:
        """Increment counters and emit a warning when the failure rate
        crosses the alert threshold."""
        self._persist_attempts += 1
        if not success:
            self._persist_failures += 1

        # Alert when ≥3 failures AND failure rate ≥ 50%.
        if (
            self._persist_failures >= 3
            and self._persist_attempts > 0
            and (self._persist_failures / self._persist_attempts) >= 0.5
        ):
            logger.warning(
                "Journal persistence is degraded: %d/%d operations failed (%.0f%%). "
                "Check disk space, permissions, and SQLite locks.",
                self._persist_failures,
                self._persist_attempts,
                100 * self._persist_failures / self._persist_attempts,
            )
            log_event(
                logger,
                "journal_persistence_degraded",
                failures=self._persist_failures,
                attempts=self._persist_attempts,
                failure_rate=round(self._persist_failures / self._persist_attempts, 3),
            )

    def start_run(self, run: ResearchRun | None) -> ResearchRun | None:
        if not self.service or not run:
            return run
        try:
            result = self.service.start_research_run(run)
            self._record_persist_attempt(success=True)
            return result
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not save research run start: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="start_run",
                run_id=getattr(run, "id", None),
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return run

    def save_quant_signals(
        self,
        run: ResearchRun | None,
        result: SignalResult | None,
    ) -> tuple[ResearchRun | None, list[Signal]]:
        if not self.service or not run or result is None:
            return run, []
        if not run.id:
            return run, []
        try:
            stale_mode = self.config.get("stale_data", {}).get("mode", "warn")

            # --- Phase 4 (tail): build reliability map from historical evaluations ---
            reliability_map: dict[str, dict[str, float | int]] | None = None
            try:
                from tradingagents.signals.provenance import (
                    build_reliability_map_from_evaluations,
                )
                from tradingagents.services.evaluation_service import EvaluationService

                eval_svc = EvaluationService(config=self.config)
                factor_report = eval_svc.build_factor_reliability()
                if factor_report and factor_report.factors:
                    reliability_map = build_reliability_map_from_evaluations(
                        factor_report.factors
                    )
                    logger.debug(
                        "Loaded reliability map with %d factors from %d evaluations",
                        len(reliability_map),
                        factor_report.total_sample_size,
                    )
            except Exception as exc:
                logger.debug("Could not build reliability map: %s", exc)

            domain_signals = signal_result_to_domain_signals(
                result,
                stale_mode=stale_mode,
                reliability_map=reliability_map,
            )
            market_snapshot = build_market_snapshot(result, research_run_id=run.id)
            signal_snapshot = build_signal_snapshot(
                research_run_id=run.id,
                symbol=result.symbol,
                signals=domain_signals,
            )
            run, signals, market_snapshot, signal_snapshot = (
                self.service.save_quant_signal_bundle(
                    run,
                    domain_signals,
                    market_snapshot,
                    signal_snapshot,
                )
            )
            assert run.id is not None
            stale_count = signal_snapshot.stale_count
            total_count = len(signal_snapshot.signal_ids or [])
            stale_ratio = (stale_count / total_count) if total_count else 0.0
            status = "healthy"
            if total_count == 0:
                status = "missing"
            elif stale_ratio >= 0.5:
                status = "degraded"
            log_event(
                logger,
                "snapshot_health",
                run_id=run.id,
                symbol=run.symbol,
                market_snapshot_id=run.market_snapshot_id,
                signal_snapshot_id=run.signal_snapshot_id,
                signal_count=total_count,
                stale_count=stale_count,
                unknown_freshness_count=signal_snapshot.unknown_freshness_count,
                stale_ratio=round(stale_ratio, 4),
                status=status,
            )
            log_event(
                logger,
                "signal_generated",
                run_id=run.id,
                decision_id=run.decision_id,
                symbol=run.symbol,
                composite_score=result.score.value,
                composite_direction=result.trend_direction,
                confidence=result.confidence,
                signal_count=total_count,
                bullish_count=signal_snapshot.bullish_count,
                bearish_count=signal_snapshot.bearish_count,
                neutral_count=signal_snapshot.neutral_count,
                stale_count=stale_count,
            )
            self._record_persist_attempt(success=True)
            return run, signals
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not save quant signals to journal: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="save_quant_signals",
                run_id=getattr(run, "id", None),
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return run, []

    def complete_run(
        self,
        run: ResearchRun | None,
        thesis: TradeThesis | None,
        *,
        scenario_plan_text: str = "",
        scenario_plan_json: str = "",
    ) -> tuple[ResearchRun | None, TradeThesis | None]:
        if not self.service or not run:
            return run, thesis
        try:
            parsed_scenarios: list[Scenario] = []
            parsed_from_json = False
            if thesis:
                thesis.research_run_id = run.id
                if scenario_plan_json:
                    try:
                        plan = ScenarioPlan.model_validate_json(scenario_plan_json)
                        parsed_scenarios = scenarios_from_structured_plan(plan, "")
                        parsed_from_json = bool(parsed_scenarios)
                    except Exception as exc:
                        logger.warning("Could not parse scenario_plan_json: %s", exc)
                if not parsed_from_json and scenario_plan_text:
                    parsed_scenarios = _parse_scenario_plan(scenario_plan_text, "")
            run, thesis, _saved_scenarios = self.service.complete_research_run_bundle(
                run,
                thesis,
                parsed_scenarios,
            )

            # Best-effort: evaluate any matured theses that lack evaluations
            if run and run.id:
                try:
                    from tradingagents.services.performance_tracker import (
                        PerformanceTracker,
                    )

                    tracker = PerformanceTracker(self.config)
                    count = tracker.evaluate_matured_theses(max_batch=5)
                    if count:
                        logger.info(
                            "Auto-evaluated %d matured theses after run %s",
                            count,
                            run.id,
                        )
                except Exception as exc:
                    logger.debug("Auto-evaluation skipped: %s", exc)

                # --- Phase 4 (tail): snapshot reliability after evaluation ---
                try:
                    self.save_reliability_snapshot(
                        symbol=run.symbol,
                        research_run_id=run.id,
                        rolling_window_days=30,
                    )
                    self.save_reliability_snapshot(
                        symbol=run.symbol,
                        research_run_id=run.id,
                        rolling_window_days=90,
                    )
                except Exception as exc:
                    logger.debug("Reliability snapshot skipped: %s", exc)

            self._record_persist_attempt(success=True)
            return run, thesis
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not complete research journal entry: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="complete_run",
                run_id=getattr(run, "id", None),
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return run, thesis

    def save_scenarios_from_plan(
        self,
        scenario_plan_text: str,
        thesis_id: str,
    ) -> list[Scenario]:
        """Parse Scenario Planner output and persist structured Scenario rows."""
        if not self.service or not scenario_plan_text or not thesis_id:
            return []
        parsed = _parse_scenario_plan(scenario_plan_text, thesis_id)
        if not parsed:
            return []
        try:
            result = self.service.save_scenarios(parsed)
            self._record_persist_attempt(success=True)
            return result
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not save scenarios: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="save_scenarios",
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return []

    def save_scenarios_from_json_plan(
        self,
        scenario_plan_json: str,
        thesis_id: str,
    ) -> list[Scenario]:
        """Persist scenarios from a structured ``ScenarioPlan`` JSON payload."""
        if not self.service or not scenario_plan_json or not thesis_id:
            return []
        try:
            plan = ScenarioPlan.model_validate_json(scenario_plan_json)
        except Exception as e:
            logger.warning("Could not parse scenario_plan_json: %s", e)
            return []
        parsed = scenarios_from_structured_plan(plan, thesis_id)
        if not parsed:
            return []
        try:
            result = self.service.save_scenarios(parsed)
            self._record_persist_attempt(success=True)
            return result
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not save scenarios from JSON plan: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="save_scenarios_json",
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return []

    def save_reliability_snapshot(
        self,
        symbol: str,
        *,
        research_run_id: str | None = None,
        rolling_window_days: int = 30,
    ) -> None:
        """Build and persist a reliability snapshot from recent evaluations.

        Queries the evaluation service for per-factor hit rates over the
        specified rolling window and saves a ``ReliabilitySnapshot`` to
        the journal for trend tracking.
        """
        if not self.service:
            return
        try:
            from tradingagents.domain.snapshot import (
                FactorReliabilityEntry,
                ReliabilitySnapshot,
            )
            from tradingagents.services.evaluation_service import EvaluationService

            eval_svc = EvaluationService(config=self.config)
            factor_report = eval_svc.build_factor_reliability()
            if not factor_report or not factor_report.factors:
                return

            entries = [
                FactorReliabilityEntry(
                    factor_name=f.factor_name,
                    hit_rate=f.hit_rate,
                    directional_accuracy=f.directional_accuracy,
                    sample_size=f.sample_size,
                )
                for f in factor_report.factors
            ]

            snapshot = ReliabilitySnapshot(
                symbol=symbol,
                rolling_window_days=rolling_window_days,
                overall_hit_rate=None,  # Computed from all factor evaluations
                overall_sample_size=factor_report.total_sample_size,
                factors=entries,
            )

            event_payload = {
                "symbol": symbol,
                "rolling_window_days": rolling_window_days,
                "factor_count": len(entries),
                "total_sample_size": factor_report.total_sample_size,
            }
            event_message = (
                f"Reliability snapshot ({rolling_window_days}d) for {symbol}: "
                f"{len(entries)} factors, "
                f"sample={factor_report.total_sample_size}"
            )
            saved = self.service.save_reliability_snapshot(
                snapshot,
                research_run_id=research_run_id,
                event_message=event_message if research_run_id else None,
                event_payload=event_payload if research_run_id else None,
            )
            if saved and saved.id:
                logger.debug(
                    "Saved reliability snapshot %s for %s (%dd window, %d factors)",
                    saved.id,
                    symbol,
                    rolling_window_days,
                    len(entries),
                )
        except Exception as exc:
            logger.debug("Could not save reliability snapshot: %s", exc)

    def save_agent_research(
        self,
        run: ResearchRun | None,
        final_state: dict,
        quant_signal_result: SignalResult | None,
    ) -> tuple[ResearchRun | None, list[AgentOpinion], ResearchDebate | None]:
        if not self.service or not run:
            return run, [], None

        try:
            opinions = build_agent_opinions(
                final_state,
                research_run_id=run.id,
                quant_signal_result=quant_signal_result,
            )
            debate = build_research_debate(
                symbol=run.symbol,
                research_run_id=run.id,
                opinions=opinions,
            )
            run, opinions, debate = self.service.save_agent_research_bundle(
                run,
                opinions,
                debate,
            )
            log_event(
                logger,
                "risk_checked",
                run_id=run.id,
                decision_id=run.decision_id,
                symbol=run.symbol,
                debate_id=debate.id,
                consensus_stance=debate.consensus_stance.value,
                conflict_level=debate.conflict_level.value,
                opinion_count=len(opinions),
                stance_counts=debate.stance_counts,
            )
            self._record_persist_attempt(success=True)
            return run, opinions, debate
        except Exception as e:
            self._record_persist_attempt(success=False)
            logger.warning("Could not save structured agent research: %s", e)
            log_event(
                logger,
                "storage_operation_failed",
                operation="save_agent_research",
                run_id=getattr(run, "id", None),
                error_type=type(e).__name__,
                error=str(e)[:500],
            )
            return run, [], None


# ---------------------------------------------------------------------------
# Scenario plan parsing
# ---------------------------------------------------------------------------


def scenarios_from_structured_plan(
    plan: ScenarioPlan,
    thesis_id: str,
) -> list[Scenario]:
    """Map a pydantic ``ScenarioPlan`` to domain ``Scenario`` rows."""
    import uuid

    out: list[Scenario] = []
    for item in plan.scenarios:
        band = _probability_band_from_label(item.probability_band)
        out.append(
            Scenario(
                id=str(uuid.uuid4()),
                thesis_id=thesis_id,
                condition=item.condition,
                expected_market_behavior=item.expected_behavior,
                probability_band=band,
                invalidation=item.invalidation,
                risk_map=(item.risk_factors or [])[:16],
                suggested_user_action=item.suggested_action or "review",
            )
        )
    return out


def _probability_band_from_label(raw: str) -> ScenarioProbabilityBand:
    s = (raw or "").strip().lower()
    if s in ("high", "hi"):
        return ScenarioProbabilityBand.HIGH
    if s in ("medium", "med", "mid"):
        return ScenarioProbabilityBand.MEDIUM
    if s in ("low",):
        return ScenarioProbabilityBand.LOW
    return ScenarioProbabilityBand.UNKNOWN


def _parse_scenario_plan(
    text: str,
    thesis_id: str,
) -> list[Scenario]:
    """Parse Scenario Planner free-text output into structured Scenario objects.

    Splits on scenario headers (e.g. "Scenario 1:", "**Scenario A**") and
    extracts condition, behavior, probability, invalidation, risk map, and
    suggested action from each block.
    """
    import uuid

    blocks = _re.split(r"(?:^|\n)(?:\*{0,2})Scenario\s*\d*[:\-—–]\s*\*{0,2}", text)
    if len(blocks) <= 1:
        # Try alternative splitting: bullet points or numbered items
        blocks = _re.split(r"\n\s*(?:\d+\.|\•|\-)\s+", text)

    scenarios: list[Scenario] = []
    for block in blocks:
        block = block.strip()
        if not block or len(block) < 20:
            continue

        condition = _extract_section(
            block, "condition|key market|market condition|catalyst|trigger"
        )
        behavior = _extract_section(
            block, "behavior|expected|outcome|price action|market move"
        )
        prob_raw = _extract_section(block, "probability|likelihood|odds")
        invalidation = _extract_section(block, "invalidation|invalid|negate|counter")
        risk_raw = _extract_section(block, "risk|risk map|risk factor")
        action = _extract_section(block, "action|suggested|recommend|response")

        # Map probability text to band
        prob_band = ScenarioProbabilityBand.UNKNOWN
        if prob_raw:
            prob_lower = prob_raw.lower()
            if any(
                w in prob_lower
                for w in ("high", "likely", "probable", "70", "80", "90")
            ):
                prob_band = ScenarioProbabilityBand.HIGH
            elif any(
                w in prob_lower
                for w in ("medium", "moderate", "possible", "40", "50", "60")
            ):
                prob_band = ScenarioProbabilityBand.MEDIUM
            elif any(
                w in prob_lower for w in ("low", "unlikely", "remote", "10", "20", "30")
            ):
                prob_band = ScenarioProbabilityBand.LOW

        # Split risk text into list items
        risk_items: list[str] = []
        if risk_raw:
            risk_items = [
                r.strip() for r in _re.split(r"[,;•\n]", risk_raw) if r.strip()
            ]

        scenario = Scenario(
            id=str(uuid.uuid4()),
            thesis_id=thesis_id,
            condition=condition or block[:120],
            expected_market_behavior=behavior or block[:120] if not condition else "",
            probability_band=prob_band,
            invalidation=invalidation or "",
            risk_map=risk_items[:8],
            suggested_user_action=action or "review",
        )
        scenarios.append(scenario)

    return scenarios


def _extract_section(text: str, field_pattern: str) -> str | None:
    """Extract a named subsection from scenario text."""
    pattern = rf"(?:^|\n)\s*(?:\*{{0,2}})?(?:{field_pattern})(?:\*{{0,2}})?\s*[:\-—–]\s*(.+?)(?:\n\s*(?:\*{{0,2}})?(?:{field_pattern}|condition|behavior|probability|invalidation|risk|action)|$)"
    match = _re.search(pattern, text, _re.IGNORECASE | _re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


_re = __import__("re")
