"""Journal persistence coordination for graph runs."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from tradingagents.domain import ResearchRun, ResearchRunStatus
from tradingagents.graph.journal_bridge import JournalBridge

logger = logging.getLogger(__name__)


class JournalCoordinator:
    """Coordinates best-effort journal persistence and degraded policy."""

    def __init__(self, config: dict[str, Any]):
        self.bridge = JournalBridge(config)

    @property
    def service(self):
        return getattr(self.bridge, "service", None)

    def start_run(self, run: ResearchRun | None) -> ResearchRun | None:
        return self.bridge.start_run(run)

    def save_quant_signals(self, run: ResearchRun | None, quant_signal_result: Any):
        if run is None:
            return run, []
        return self.bridge.save_quant_signals(run, quant_signal_result)

    def save_agent_research(
        self,
        run: ResearchRun | None,
        final_state: dict,
        quant_signal_result: Any,
    ):
        return self.bridge.save_agent_research(run, final_state, quant_signal_result)

    def complete_run(
        self,
        run: ResearchRun | None,
        thesis,
        *,
        scenario_plan_text: str = "",
        scenario_plan_json: str = "",
    ):
        return self.bridge.complete_run(
            run,
            thesis,
            scenario_plan_text=scenario_plan_text,
            scenario_plan_json=scenario_plan_json,
        )

    def mark_failed(self, run: ResearchRun | None, exc: Exception) -> None:
        if not run or not self.service:
            return
        try:
            run.status = ResearchRunStatus.FAILED
            run.completed_at = datetime.now(timezone.utc)
            saved = self.service.update_research_run(run)
            if saved.id:
                self.service.add_run_event(
                    saved.id,
                    "run.failed",
                    f"Research run failed for {saved.symbol}: {type(exc).__name__}",
                    {
                        "error_type": type(exc).__name__,
                        "error": str(exc)[:500],
                    },
                    thesis_id=saved.thesis_id,
                )
        except Exception as persist_exc:
            logger.debug("Could not mark failed research run in journal: %s", persist_exc)
