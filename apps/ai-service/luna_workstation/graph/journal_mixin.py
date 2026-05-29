"""Journal persistence mixin extracted from ``ResearchAgentsGraph``.

Provides ``_start_journal_run``, ``_save_journal_quant_signals``,
``_complete_journal_run``, and ``_save_journal_agent_research`` as a
reusable mixin so the main graph class stays focused on orchestration.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from luna_workstation.domain.research_run import ResearchRun

logger = logging.getLogger(__name__)


class JournalPersistenceMixin:
    """Mixin that adds journal lifecycle methods to a graph orchestrator.

    Requires the host class to expose:
    - ``self.current_research_run``
    - ``self.journal_bridge`` (a :class:`JournalBridge` or None)
    - ``self.current_trade_thesis`` (optional, may be None)
    """

    current_research_run: "ResearchRun | None"

    def _start_journal_run(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if not isinstance(bridge, object) or not hasattr(bridge, "start_run"):
            return
        self.current_research_run = bridge.start_run(self.current_research_run)

    def _save_journal_quant_signals(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        run = getattr(self, "current_research_run", None)
        if bridge is None or run is None:
            return
        if not hasattr(bridge, "save_quant_signals"):
            return
        self.current_research_run, self.current_signals = bridge.save_quant_signals(
            run,
            getattr(self, "quant_signal_result", None),
        )

    def _complete_journal_run(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if bridge is None or not hasattr(bridge, "complete_run"):
            return
        scenario_plan = getattr(self, "current_scenario_plan", "") or ""
        scenario_json = ""
        curr_state = getattr(self, "curr_state", None)
        if curr_state is not None:
            scenario_json = curr_state.get("scenario_plan_json", "") or ""
        self.current_research_run, self.current_trade_thesis = bridge.complete_run(
            getattr(self, "current_research_run", None),
            getattr(self, "current_trade_thesis", None),
            scenario_plan_text=scenario_plan,
            scenario_plan_json=scenario_json,
        )

    def _save_journal_agent_research(self, final_state: dict) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if bridge is None or not hasattr(bridge, "save_agent_research"):
            return
        (
            self.current_research_run,
            self.current_agent_opinions,
            self.current_debate,
        ) = bridge.save_agent_research(
            getattr(self, "current_research_run", None),
            final_state,
            getattr(self, "quant_signal_result", None),
        )
