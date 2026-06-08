"""Best-effort journal persistence bridge for graph runs."""

from __future__ import annotations

import logging
import re as _re

from luna_workstation.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    Scenario,
    ScenarioProbabilityBand,
    Signal,
    TradeThesis,
)
from luna_workstation.observability import log_event
from luna_workstation.services import JournalService
from luna_workstation.exceptions import StaleDataError, StorageError
from luna_workstation.signals.base import SignalResult
from luna_workstation.signals.snapshots import (
    build_market_snapshot,
    build_signal_snapshot,
)
from luna_workstation.signals.provenance import (
    FRESHNESS_WINDOW,
    signal_result_to_domain_signals,
)
from luna_workstation.agents.schemas import ScenarioPlan
from luna_workstation.graph.scenarios import build_scenarios_for_thesis
from luna_workstation.graph.opinions import build_agent_opinions, build_research_debate

logger = logging.getLogger(__name__)


def _append_unique(items: list[str], value: str) -> None:
    text = str(value).strip()
    if text and text not in items:
        items.append(text)


def _append_missing_core(run: ResearchRun, value: str) -> None:
    _append_unique(run.missing_core_data, value)


def _append_degradation_reason(run: ResearchRun, value: str) -> None:
    _append_unique(run.degradation_reasons, value)


def _merge_run_quality_from_signal_result(
    run: ResearchRun, result: SignalResult
) -> None:
    for item in getattr(result, "missing_core_data", []) or []:
        _append_unique(run.missing_core_data, item)
    for item in getattr(result, "missing_optional_data", []) or []:
        _append_unique(run.missing_optional_data, item)
    for item in getattr(result, "degradation_reasons", []) or []:
        _append_unique(run.degradation_reasons, item)


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
            raise StorageError(f"Critical journal write failed: start_run: {e}") from e

    def save_quant_signals(
        self,
        run: ResearchRun | None,
        result: SignalResult | None,
    ) -> tuple[ResearchRun | None, list[Signal]]:
        if not self.service or not run or result is None:
            if run is not None and result is None:
                _append_missing_core(run, "ohlcv_unavailable")
                _append_degradation_reason(run, "ohlcv_unavailable")
            return run, []
        if not run.id:
            return run, []
        try:
            _merge_run_quality_from_signal_result(run, result)
            stale_mode = self.config.get("stale_data", {}).get("mode", "warn")
            max_age_hours = self.config.get("stale_data", {}).get(
                "max_age_hours",
                FRESHNESS_WINDOW.total_seconds() / 3600.0,
            )

            # --- Phase 4 (tail): build reliability map from historical evaluations ---
            reliability_map: dict[str, dict[str, float | int]] | None = None
            try:
                from luna_workstation.signals.provenance import (
                    build_reliability_map_from_evaluations,
                )
                from luna_workstation.services.evaluation_service import (
                    EvaluationService,
                )

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
                max_age_hours=max_age_hours,
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
        except StaleDataError:
            self._record_persist_attempt(success=False)
            raise
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
            raise StorageError(
                f"Critical journal write failed: save_quant_signals: {e}"
            ) from e

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
                if not parsed_scenarios and (scenario_plan_json or scenario_plan_text):
                    parsed_scenarios = build_scenarios_for_thesis(
                        thesis,
                        template_name=getattr(thesis.setup_type, "value", thesis.setup_type),
                    )
                    if run.id:
                        self.service.add_run_event(
                            run.id,
                            "scenario.plan.degraded",
                            "Scenario Planner output could not be parsed; saved deterministic fallback scenarios.",
                            {
                                "scenario_count": len(parsed_scenarios),
                                "had_json": bool(scenario_plan_json),
                                "had_text": bool(scenario_plan_text),
                                "thesis_id": thesis.id,
                            },
                            thesis_id=thesis.id,
                        )
            run, thesis, _saved_scenarios = self.service.complete_research_run_bundle(
                run,
                thesis,
                parsed_scenarios,
            )

            # Best-effort: evaluate any matured theses that lack evaluations
            if run and run.id:
                try:
                    from luna_workstation.services.performance_tracker import (
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
            raise StorageError(
                f"Critical journal write failed: complete_run: {e}"
            ) from e

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
            from luna_workstation.domain.snapshot import (
                FactorReliabilityEntry,
                ReliabilitySnapshot,
            )
            from luna_workstation.services.evaluation_service import EvaluationService

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
            news_snapshot = final_state.get("news_context_snapshot")
            if run.id and isinstance(news_snapshot, dict) and news_snapshot:
                quality = news_snapshot.get("quality") or {}
                self.service.add_run_event(
                    run.id,
                    "news.context.snapshot",
                    f"News context snapshot recorded for {run.symbol}",
                    {
                        "quality": quality,
                        "coverage": news_snapshot.get("coverage") or {},
                        "item_count": len(news_snapshot.get("items") or []),
                        "story_cluster_count": len(
                            news_snapshot.get("story_clusters") or []
                        ),
                    },
                )
            risk_state = final_state.get("risk_debate_state") or {}
            if run.id and risk_state:
                self.service.add_run_event(
                    run.id,
                    "risk.debate.recorded",
                    f"Risk debate recorded for {run.symbol}",
                    {
                        "debate_id": debate.id,
                        "judge_decision": risk_state.get("judge_decision", ""),
                        "history_length": len(str(risk_state.get("history", ""))),
                        "aggressive_history_length": len(
                            str(risk_state.get("aggressive_history", ""))
                        ),
                        "neutral_history_length": len(
                            str(risk_state.get("neutral_history", ""))
                        ),
                        "conservative_history_length": len(
                            str(risk_state.get("conservative_history", ""))
                        ),
                    },
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
    for item in plan.scenarios[:4]:
        band = _probability_band_from_label(item.probability_band)
        as_of, timeframe, source = _normalize_scenario_provenance(
            item.as_of,
            item.timeframe,
            item.source,
        )
        out.append(
            Scenario(
                id=str(uuid.uuid4()),
                thesis_id=thesis_id,
                scenario_name=item.scenario_name,
                direction=item.direction,
                thesis_impact=item.thesis_impact,
                condition=item.condition,
                expected_market_behavior=item.expected_behavior,
                probability_band=band,
                invalidation=item.invalidation,
                evidence=(item.evidence or [])[:12],
                watch_triggers=(item.watch_triggers or [])[:12],
                impact_on_thesis=item.impact_on_thesis,
                risk_map=(item.risk_factors or [])[:16],
                suggested_user_action=item.suggested_action or "review",
                as_of=as_of,
                timeframe=timeframe,
                source=source[:8],
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

    blocks = _split_scenario_blocks(text)

    scenarios: list[Scenario] = []
    for block in blocks:
        block = block.strip()
        if not block or len(block) < 20:
            continue

        condition = _extract_markdown_section(block, _CONDITION_SECTION_PATTERN)
        behavior = _extract_markdown_section(block, _BEHAVIOR_SECTION_PATTERN)
        prob_raw = _extract_markdown_section(block, _PROBABILITY_SECTION_PATTERN)
        invalidation = _extract_markdown_section(block, _INVALIDATION_SECTION_PATTERN)
        evidence_raw = _extract_markdown_section(block, _EVIDENCE_SECTION_PATTERN)
        watch_raw = _extract_markdown_section(block, _WATCH_SECTION_PATTERN)
        impact = _extract_markdown_section(block, _IMPACT_SECTION_PATTERN)
        risk_raw = _extract_markdown_section(block, _RISK_SECTION_PATTERN)
        action = _extract_markdown_section(block, _ACTION_SECTION_PATTERN)
        as_of = _extract_markdown_section(block, _AS_OF_SECTION_PATTERN)
        timeframe = _extract_markdown_section(block, _TIMEFRAME_SECTION_PATTERN)
        source_raw = _extract_markdown_section(block, _SOURCE_SECTION_PATTERN)
        clean_action, legacy_as_of, legacy_source, legacy_timeframe = (
            _extract_legacy_source_timeframe_as_of(action)
        )

        if not any(
            (
                condition,
                behavior,
                prob_raw,
                invalidation,
                evidence_raw,
                watch_raw,
                impact,
                risk_raw,
                action,
            )
        ):
            continue

        # Map probability text to band
        prob_band = ScenarioProbabilityBand.UNKNOWN
        if prob_raw:
            pct_match = _re.search(r"(\d+(?:\.\d+)?)\s*%", prob_raw)
            if pct_match:
                probability = float(pct_match.group(1))
                if probability >= 65:
                    prob_band = ScenarioProbabilityBand.HIGH
                elif probability >= 35:
                    prob_band = ScenarioProbabilityBand.MEDIUM
                else:
                    prob_band = ScenarioProbabilityBand.LOW
            else:
                prob_lower = prob_raw.lower()
                if any(
                    w in prob_lower
                    for w in (
                        "high",
                        "likely",
                        "probable",
                        "cao",
                        "khả năng cao",
                        "kha nang cao",
                    )
                ):
                    prob_band = ScenarioProbabilityBand.HIGH
                elif any(
                    w in prob_lower
                    for w in (
                        "medium",
                        "moderate",
                        "possible",
                        "trung bình",
                        "trung binh",
                        "vừa phải",
                        "vua phai",
                        "có thể",
                        "co the",
                    )
                ):
                    prob_band = ScenarioProbabilityBand.MEDIUM
                elif any(
                    w in prob_lower
                    for w in (
                        "low",
                        "unlikely",
                        "remote",
                        "thấp",
                        "thap",
                        "ít khả năng",
                        "it kha nang",
                    )
                ):
                    prob_band = ScenarioProbabilityBand.LOW

        risk_items = _split_list_section(risk_raw)

        scenario = Scenario(
            id=str(uuid.uuid4()),
            thesis_id=thesis_id,
            scenario_name=_extract_scenario_heading_name(block),
            condition=condition or _clean_section_text(block),
            expected_market_behavior=behavior or impact or "",
            probability_band=prob_band,
            invalidation=invalidation or "",
            evidence=_split_list_section(evidence_raw)[:12],
            watch_triggers=_split_list_section(watch_raw)[:12],
            impact_on_thesis=impact or "",
            risk_map=risk_items[:8],
            suggested_user_action=clean_action or "review",
            **_scenario_provenance_kwargs(
                as_of or legacy_as_of or "",
                timeframe or legacy_timeframe or "",
                _split_list_section(source_raw) or legacy_source,
            ),
        )
        scenarios.append(scenario)

    return scenarios


def _scenario_provenance_kwargs(
    as_of: str,
    timeframe: str,
    source: list[str],
) -> dict[str, object]:
    normalized_as_of, normalized_timeframe, normalized_source = (
        _normalize_scenario_provenance(as_of, timeframe, source)
    )
    return {
        "as_of": normalized_as_of,
        "timeframe": normalized_timeframe,
        "source": normalized_source[:8],
    }


def _normalize_scenario_provenance(
    as_of: str,
    timeframe: str,
    source: list[str],
) -> tuple[str, str, list[str]]:
    cleaned_as_of = str(as_of or "").strip()
    cleaned_timeframe = str(timeframe or "").strip()
    cleaned_source = [str(item or "").strip() for item in source if str(item or "").strip()]

    if not cleaned_as_of and cleaned_timeframe:
        match = _AS_OF_IN_TIMEFRAME_RE.search(cleaned_timeframe)
        if match:
            cleaned_as_of = match.group(1)
            cleaned_timeframe = _AS_OF_IN_TIMEFRAME_RE.sub("", cleaned_timeframe)
            cleaned_timeframe = cleaned_timeframe.strip(" -–—().")
    if not cleaned_as_of:
        source_text = " ".join(cleaned_source)
        match = _DATE_IN_TEXT_RE.search(source_text)
        if match:
            cleaned_as_of = match.group(1)
    return cleaned_as_of, cleaned_timeframe, cleaned_source


def _extract_legacy_source_timeframe_as_of(text: str) -> tuple[str, str, list[str], str]:
    raw = str(text or "").strip()
    match = _re.search(
        r"\bSource,\s*timeframe,\s*(?:and\s*)?as_of\b\s*:?\s*(.*)$",
        raw,
        _re.IGNORECASE | _re.DOTALL,
    )
    if not match:
        return raw, "", [], ""
    cleaned = raw[: match.start()].strip()
    source_text = match.group(1).strip()
    date_match = _DATE_IN_TEXT_RE.search(source_text)
    source, timeframe = _split_legacy_source_and_timeframe(source_text)
    if not timeframe:
        timeframe_match = _re.search(
            r"\b(1m|5m|15m|1h|4h|daily|weekly|monthly|1D|4H|1W)\b",
            source_text,
            _re.IGNORECASE,
        )
        timeframe = timeframe_match.group(1) if timeframe_match else ""
    return cleaned, date_match.group(1) if date_match else "", source, timeframe


def _split_legacy_source_and_timeframe(text: str) -> tuple[list[str], str]:
    source: list[str] = []
    timeframe = ""
    for line in str(text or "").splitlines():
        cleaned = line.strip().strip(" -*")
        if not cleaned:
            continue
        timeframe_match = _re.match(
            r"^(?:khung\s+thời\s+gian\s+ưu\s+tiên|khung\s+thoi\s+gian\s+uu\s+tien|"
            r"time\s*frame|timeframe)\s*:?\s*(.+)$",
            cleaned,
            _re.IGNORECASE,
        )
        if timeframe_match:
            timeframe = timeframe_match.group(1).strip().rstrip(".")
            continue
        source.append(cleaned.rstrip("."))
    return source, timeframe


def _extract_section(text: str, field_pattern: str) -> str | None:
    """Extract a named subsection from scenario text."""
    pattern = rf"(?:^|\n)\s*(?:\*{{0,2}})?(?:{field_pattern})(?:\*{{0,2}})?\s*[:\-—–]\s*(.+?)(?:\n\s*(?:\*{{0,2}})?(?:{field_pattern}|condition|behavior|probability|invalidation|risk|action)|$)"
    match = _re.search(pattern, text, _re.IGNORECASE | _re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


_DASH_PATTERN = r"[:\-\u2013\u2014]"
_DATE_IN_TEXT_RE = _re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_AS_OF_IN_TIMEFRAME_RE = _re.compile(
    r"\(?\s*as[_\s-]*of\s*:\s*(\d{4}-\d{2}-\d{2})\s*\)?\.?",
    _re.IGNORECASE,
)
_CONDITION_SECTION_PATTERN = (
    r"key\s+market\s+conditions?(?:\s*(?:&|and)\s*catalysts?)?|"
    r"market\s+conditions?|catalysts?|condition|trigger|"
    r"điều\s+kiện(?:\s+thị\s+trường)?|dieu\s+kien(?:\s+thi\s+truong)?|"
    r"chất\s+xúc\s+tác|chat\s+xuc\s+tac"
)
_BEHAVIOR_SECTION_PATTERN = (
    r"expected\s+behavior|behavior|expected|outcome|price\s+action|"
    r"market\s+move|hành\s+vi\s+dự\s+kiến|hanh\s+vi\s+du\s+kien|"
    r"diễn\s+biến\s+dự\s+kiến|dien\s+bien\s+du\s+kien|kết\s+quả|ket\s+qua"
)
_PROBABILITY_SECTION_PATTERN = (
    r"probability\s+assessment|probability|likelihood|odds|"
    r"xác\s+suất|xac\s+suat|khả\s+năng|kha\s+nang"
)
_INVALIDATION_SECTION_PATTERN = (
    r"invalidation|invalid|negate|counter|"
    r"vô\s+hiệu|vo\s+hieu|điểm\s+vô\s+hiệu|diem\s+vo\s+hieu|phủ\s+định|phu\s+dinh"
)
_EVIDENCE_SECTION_PATTERN = (
    r"observed\s+evidence|evidence\s+(?:chips?|items?)|evidence|"
    r"bằng\s+chứng|bang\s+chung|dữ\s+liệu\s+hỗ\s+trợ|du\s+lieu\s+ho\s+tro"
)
_WATCH_SECTION_PATTERN = (
    r"watch\s+triggers?|watch\s+conditions?|triggers?|watch|monitor|"
    r"điều\s+kiện\s+theo\s+dõi|dieu\s+kien\s+theo\s+doi|"
    r"tín\s+hiệu\s+theo\s+dõi|tin\s+hieu\s+theo\s+doi|theo\s+dõi|theo\s+doi"
)
_IMPACT_SECTION_PATTERN = (
    r"impact\s+on\s+(?:investment\s+)?thesis|impact\s+on\s+thesis|thesis\s+impact|"
    r"tác\s+động\s+(?:lên|đến)\s+luận\s+điểm|tac\s+dong\s+(?:len|den)\s+luan\s+diem|"
    r"ảnh\s+hưởng\s+(?:lên|đến)\s+luận\s+điểm|anh\s+huong\s+(?:len|den)\s+luan\s+diem"
)
_RISK_SECTION_PATTERN = r"risk\s+factors?|risk\s+map|risk|rủi\s+ro|rui\s+ro"
_ACTION_SECTION_PATTERN = (
    r"recommended\s+response|suggested\s+action|action\s+watch|"
    r"action\s+review|action|recommend|response|"
    r"hành\s+động\s+đề\s+xuất|hanh\s+dong\s+de\s+xuat|"
    r"phản\s+ứng\s+khuyến\s+nghị|phan\s+ung\s+khuyen\s+nghi|hành\s+động|hanh\s+dong"
)
_AS_OF_SECTION_PATTERN = (
    r"as\s+of|as_of|evidence\s+as\s+of|tại\s+thời\s+điểm|tai\s+thoi\s+diem"
)
_TIMEFRAME_SECTION_PATTERN = (
    r"timeframe|time\s+frame|horizon|khung\s+thời\s+gian|khung\s+thoi\s+gian"
)
_SOURCE_SECTION_PATTERN = r"source\s+artifacts?|sources?|source|nguồn|nguon"
_COMBINED_DECISION_SECTION_PATTERN = (
    r"evidence\s+chips?\s*(?:&|and)\s*watch\s+triggers?"
)
_PROVENANCE_SECTION_PATTERN = (
    r"source\s*(?:&|and)\s*time\s*frame|source\s*(?:&|and)\s*as_of"
)
_ANY_SECTION_PATTERN = "|".join(
    (
        _CONDITION_SECTION_PATTERN,
        _BEHAVIOR_SECTION_PATTERN,
        _PROBABILITY_SECTION_PATTERN,
        _INVALIDATION_SECTION_PATTERN,
        _EVIDENCE_SECTION_PATTERN,
        _WATCH_SECTION_PATTERN,
        _IMPACT_SECTION_PATTERN,
        _RISK_SECTION_PATTERN,
        _ACTION_SECTION_PATTERN,
        _AS_OF_SECTION_PATTERN,
        _TIMEFRAME_SECTION_PATTERN,
        _SOURCE_SECTION_PATTERN,
        _COMBINED_DECISION_SECTION_PATTERN,
        _PROVENANCE_SECTION_PATTERN,
    )
)
_SCENARIO_HEADING_PATTERN = (
    rf"^\s*(?:#{{1,6}}\s*)?(?:\*{{0,2}})?(?:Scenario|Kịch\s+bản|Kich\s+ban)\s*(?:\d+|[A-Z])?"
    rf"\s*{_DASH_PATTERN}\s*.*$"
)


def _split_scenario_blocks(text: str) -> list[str]:
    """Split markdown/free-text scenario plans into scenario-sized blocks."""

    matches = list(
        _re.finditer(
            _SCENARIO_HEADING_PATTERN,
            text,
            _re.IGNORECASE | _re.MULTILINE,
        )
    )
    if not matches:
        matches = list(
            _re.finditer(
                rf"^\s*\d+[\.\)]\s+(?:\*{{0,2}})?Scenario\s*(?:\d+|[A-Z])?"
                rf"\s*{_DASH_PATTERN}?\s*.*$"
                rf"|^\s*\d+[\.\)]\s+(?:\*{{0,2}})?(?:Kịch\s+bản|Kich\s+ban)\s*(?:\d+|[A-Z])?"
                rf"\s*{_DASH_PATTERN}?\s*.*$",
                text,
                _re.IGNORECASE | _re.MULTILINE,
            )
        )

    if matches:
        return [
            text[
                match.start() : matches[i + 1].start()
                if i + 1 < len(matches)
                else len(text)
            ].strip()
            for i, match in enumerate(matches)
        ]

    # Last-resort fallback for older free-text outputs. Keep it conservative:
    # only candidate blocks with recognizable scenario fields are persisted.
    return [
        block.strip()
        for block in _re.split(r"\n\s*(?:\d+[\.\)]|\-)\s+", text)
        if _re.search(_ANY_SECTION_PATTERN, block, _re.IGNORECASE)
    ]


def _clean_section_text(text: str) -> str:
    """Remove markdown list/heading noise without truncating content."""

    lines: list[str] = []
    for raw_line in text.strip().splitlines():
        line = raw_line.strip()
        if not line or line == "---":
            continue
        line = line.replace("**", "").replace("__", "").replace("`", "")
        line = _re.sub(r"^\s*(?:[-*]|\d+[\.\)])\s+", "", line)
        line = _re.sub(r"\s{2,}", " ", line)
        lines.append(line)
    return "\n".join(lines).strip()


def _extract_scenario_heading_name(text: str) -> str:
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    match = _re.match(
        rf"\s*(?:#{{1,6}}\s*)?(?:\*{{0,2}})?(?:Scenario|Kịch\s+bản|Kich\s+ban)\s*(?:\d+|[A-Z])?"
        rf"\s*{_DASH_PATTERN}\s*(?P<name>.+?)\*{{0,2}}\s*$",
        first_line,
        _re.IGNORECASE,
    )
    if not match:
        return ""
    return _clean_section_text(match.group("name"))


def _split_list_section(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [
        _clean_section_text(item)
        for item in _re.split(r"[;\u2022\n]", raw)
        if _clean_section_text(item)
    ]


def _extract_markdown_section(text: str, field_pattern: str) -> str | None:
    """Extract a named markdown subsection from scenario text."""

    section_label = _section_label_pattern(field_pattern)
    any_section_label = _section_label_pattern(_ANY_SECTION_PATTERN)
    pattern = (
        rf"(?:^|\n)\s*(?:#{{1,6}}\s*)?(?:[-*]\s*)?"
        rf"{section_label}"
        rf"(?P<body>.*?)"
        rf"(?=\n\s*(?:#{{1,6}}\s*)?(?:[-*]\s*)?(?:\*{{0,2}})?"
        rf"{any_section_label}"
        rf"|\n\s*---|\Z)"
    )
    match = _re.search(pattern, text, _re.IGNORECASE | _re.DOTALL)
    if not match:
        return None
    body = _clean_section_text(match.group("body"))
    return body or None


def _section_label_pattern(field_pattern: str) -> str:
    return (
        rf"(?:\*{{0,2}})?(?:{field_pattern})(?:\*{{0,2}})?"
        rf"(?=[ \t]*(?:{_DASH_PATTERN}|\n|\Z))"
        rf"[ \t]*(?:{_DASH_PATTERN})?[ \t]*(?:\n[ \t]*)?"
    )


_re = __import__("re")
