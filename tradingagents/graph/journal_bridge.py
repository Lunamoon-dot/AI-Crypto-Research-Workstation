"""Best-effort journal persistence bridge for graph runs."""

from __future__ import annotations

import logging

from tradingagents.domain import ResearchRun, Signal, TradeThesis
from tradingagents.services import JournalService
from tradingagents.signals.base import SignalResult
from tradingagents.signals.snapshots import build_market_snapshot, build_signal_snapshot
from tradingagents.signals.provenance import signal_result_to_domain_signals

logger = logging.getLogger(__name__)


class JournalBridge:
    """Keeps journal persistence out of graph orchestration code."""

    def __init__(self, config: dict):
        self.service = None
        if config.get("journal", {}).get("enabled", True):
            try:
                self.service = JournalService(config)
            except Exception as e:
                logger.warning("Decision journal disabled: %s", e)

    def start_run(self, run: ResearchRun | None) -> ResearchRun | None:
        if not self.service or not run:
            return run
        try:
            return self.service.start_research_run(run)
        except Exception as e:
            logger.warning("Could not save research run start: %s", e)
            return run

    def save_quant_signals(
        self,
        run: ResearchRun | None,
        result: SignalResult | None,
    ) -> tuple[ResearchRun | None, list[Signal]]:
        if not self.service or not run or result is None:
            return run, []
        try:
            signals = self.service.save_signals(signal_result_to_domain_signals(result))
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
            return run, signals
        except Exception as e:
            logger.warning("Could not save quant signals to journal: %s", e)
            return run, []

    def complete_run(
        self,
        run: ResearchRun | None,
        thesis: TradeThesis | None,
    ) -> tuple[ResearchRun | None, TradeThesis | None]:
        if not self.service or not run:
            return run, thesis
        try:
            if thesis:
                thesis.research_run_id = run.id
                thesis = self.service.save_thesis(thesis)
                run.thesis_id = thesis.id
            run = self.service.complete_research_run(run)
            return run, thesis
        except Exception as e:
            logger.warning("Could not complete research journal entry: %s", e)
            return run, thesis
