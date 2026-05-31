"""Per-run graph state and compatibility accessors."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from luna_workstation.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    Signal,
    TradeThesis,
)


@dataclass
class GraphRunContext:
    """Mutable per-run state kept out of the graph object's top-level fields."""

    curr_state: dict[str, Any] | None = None
    ticker: str | None = None
    current_research_run: ResearchRun | None = None
    current_trade_thesis: TradeThesis | None = None
    current_signals: list[Signal] = field(default_factory=list)
    current_agent_opinions: list[AgentOpinion] = field(default_factory=list)
    current_debate: ResearchDebate | None = None
    log_states_dict: dict[str, Any] = field(default_factory=dict)
    quant_signal_result: Any = None
    market_context_result: Any = None
    news_context_result: Any = None
    replay_thread_id: str | None = None
    current_scenario_plan: str = ""


class GraphRunContextMixin:
    """Expose legacy graph state attributes through ``GraphRunContext``."""

    run_context: GraphRunContext

    def _ensure_run_context(self) -> GraphRunContext:
        if not hasattr(self, "run_context"):
            self.run_context = GraphRunContext()
        return self.run_context

    @property
    def curr_state(self) -> dict[str, Any] | None:
        return self._ensure_run_context().curr_state

    @curr_state.setter
    def curr_state(self, value: dict[str, Any] | None) -> None:
        self._ensure_run_context().curr_state = value

    @property
    def ticker(self) -> str | None:
        return self._ensure_run_context().ticker

    @ticker.setter
    def ticker(self, value: str | None) -> None:
        self._ensure_run_context().ticker = value

    @property
    def current_research_run(self) -> ResearchRun | None:
        return self._ensure_run_context().current_research_run

    @current_research_run.setter
    def current_research_run(self, value: ResearchRun | None) -> None:
        self._ensure_run_context().current_research_run = value

    @property
    def current_trade_thesis(self) -> TradeThesis | None:
        return self._ensure_run_context().current_trade_thesis

    @current_trade_thesis.setter
    def current_trade_thesis(self, value: TradeThesis | None) -> None:
        self._ensure_run_context().current_trade_thesis = value

    @property
    def current_signals(self) -> list[Signal]:
        return self._ensure_run_context().current_signals

    @current_signals.setter
    def current_signals(self, value: list[Signal]) -> None:
        self._ensure_run_context().current_signals = value

    @property
    def current_agent_opinions(self) -> list[AgentOpinion]:
        return self._ensure_run_context().current_agent_opinions

    @current_agent_opinions.setter
    def current_agent_opinions(self, value: list[AgentOpinion]) -> None:
        self._ensure_run_context().current_agent_opinions = value

    @property
    def current_debate(self) -> ResearchDebate | None:
        return self._ensure_run_context().current_debate

    @current_debate.setter
    def current_debate(self, value: ResearchDebate | None) -> None:
        self._ensure_run_context().current_debate = value

    @property
    def log_states_dict(self) -> dict[str, Any]:
        return self._ensure_run_context().log_states_dict

    @log_states_dict.setter
    def log_states_dict(self, value: dict[str, Any]) -> None:
        self._ensure_run_context().log_states_dict = value

    @property
    def quant_signal_result(self) -> Any:
        return self._ensure_run_context().quant_signal_result

    @quant_signal_result.setter
    def quant_signal_result(self, value: Any) -> None:
        self._ensure_run_context().quant_signal_result = value

    @property
    def market_context_result(self) -> Any:
        return self._ensure_run_context().market_context_result

    @market_context_result.setter
    def market_context_result(self, value: Any) -> None:
        self._ensure_run_context().market_context_result = value

    @property
    def news_context_result(self) -> Any:
        return self._ensure_run_context().news_context_result

    @news_context_result.setter
    def news_context_result(self, value: Any) -> None:
        self._ensure_run_context().news_context_result = value

    @property
    def _replay_thread_id(self) -> str | None:
        return self._ensure_run_context().replay_thread_id

    @_replay_thread_id.setter
    def _replay_thread_id(self, value: str | None) -> None:
        self._ensure_run_context().replay_thread_id = value

    @property
    def current_scenario_plan(self) -> str:
        return self._ensure_run_context().current_scenario_plan

    @current_scenario_plan.setter
    def current_scenario_plan(self, value: str) -> None:
        self._ensure_run_context().current_scenario_plan = value
