"""Best-effort journal persistence bridge for graph runs."""

from __future__ import annotations

import logging

from tradingagents.domain import AgentOpinion, ResearchDebate, ResearchRun, Signal, TradeThesis
from tradingagents.observability import log_event
from tradingagents.services import JournalService
from tradingagents.signals.base import SignalResult
from tradingagents.signals.snapshots import build_market_snapshot, build_signal_snapshot
from tradingagents.signals.provenance import signal_result_to_domain_signals
from tradingagents.graph.opinions import build_agent_opinions, build_research_debate
from tradingagents.graph.scenarios import build_scenarios_for_thesis

logger = logging.getLogger(__name__)


class JournalBridge:
    """Keeps journal persistence out of graph orchestration code."""

    def __init__(self, config: dict):
        self.service = None
        self.config = config
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

    def start_run(self, run: ResearchRun | None) -> ResearchRun | None:
        if not self.service or not run:
            return run
        try:
            return self.service.start_research_run(run)
        except Exception as e:
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
        try:
            stale_mode = self.config.get("stale_data", {}).get("mode", "warn")
            signals = self.service.save_signals(
                signal_result_to_domain_signals(result, stale_mode=stale_mode)
            )
            run.signal_ids = [signal.id for signal in signals if signal.id]
            market_snapshot = self.service.save_market_snapshot(
                build_market_snapshot(result, research_run_id=run.id)
            )
            signal_snapshot = self.service.save_signal_snapshot(
                build_signal_snapshot(
                    research_run_id=run.id,
                    symbol=result.symbol,
                    signals=signals,
                )
            )
            run.market_snapshot_id = market_snapshot.id
            run.signal_snapshot_id = signal_snapshot.id
            run = self.service.update_research_run(run)
            self.service.add_run_event(
                run.id,
                "snapshots_saved",
                f"Saved market snapshot and {len(signals)} signal(s)",
                {
                    "market_snapshot_id": run.market_snapshot_id,
                    "signal_snapshot_id": run.signal_snapshot_id,
                    "signal_ids": run.signal_ids,
                },
            )
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
            return run, signals
        except Exception as e:
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
        signals: list[Signal] | None = None,
        debate: ResearchDebate | None = None,
    ) -> tuple[ResearchRun | None, TradeThesis | None]:
        if not self.service or not run:
            return run, thesis
        try:
            if thesis:
                thesis.research_run_id = run.id
                thesis = self.service.save_thesis(thesis)
                run.thesis_id = thesis.id
                try:
                    scenarios = build_scenarios_for_thesis(
                        thesis,
                        debate=debate,
                        signals=signals or [],
                        template_name=thesis.setup_type if thesis.setup_type != "unspecified" else None,
                    )
                    self.service.save_scenarios(scenarios)
                except Exception as e:
                    logger.warning("Could not save thesis scenarios: %s", e)
                    log_event(
                        logger,
                        "storage_operation_failed",
                        operation="save_scenarios",
                        run_id=getattr(run, "id", None),
                        error_type=type(e).__name__,
                        error=str(e)[:500],
                    )
            run = self.service.complete_research_run(run)
            return run, thesis
        except Exception as e:
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
            opinions = self.service.save_agent_opinions(opinions)
            debate = build_research_debate(
                symbol=run.symbol,
                research_run_id=run.id,
                opinions=opinions,
            )
            debate = self.service.save_debate(debate)
            for opinion in opinions:
                opinion.debate_id = debate.id
            opinions = self.service.save_agent_opinions(opinions)
            debate.opinion_ids = [opinion.id for opinion in opinions if opinion.id]
            debate = self.service.save_debate(debate)
            run.debate_id = debate.id
            run = self.service.update_research_run(run)
            return run, opinions, debate
        except Exception as e:
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
