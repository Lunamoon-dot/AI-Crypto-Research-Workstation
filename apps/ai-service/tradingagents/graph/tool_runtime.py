"""Provider/config-bound runtime tools and LLM handles."""

from __future__ import annotations

from typing import Any

from tradingagents.llm_clients.orchestrator import LLMOrchestrator
from tradingagents.observability.budget import BudgetCallbackHandler, BudgetTracker

from .signal_processing import SignalProcessor
from .tooling import create_tool_nodes


class ToolRuntime:
    """Owns LLM callbacks, provider fallback, and config-bound tool nodes."""

    def __init__(self, config: dict[str, Any], callbacks: list[Any] | None = None):
        self.config = config
        self.budget_tracker = BudgetTracker(config)
        self.callbacks = [
            *(callbacks or []),
            BudgetCallbackHandler(self.budget_tracker),
        ]
        self.orchestrator = LLMOrchestrator(config=config, callbacks=self.callbacks)
        self.deep_thinking_llm, self.quick_thinking_llm = (
            self.orchestrator.create_primary_llms()
        )
        self.tool_nodes = create_tool_nodes(config)
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

    def create_tool_nodes(self):
        return create_tool_nodes(self.config)

    def apply_provider_switch(self, host: Any, deep_llm: Any, quick_llm: Any) -> None:
        self.deep_thinking_llm = deep_llm
        self.quick_thinking_llm = quick_llm
        self.signal_processor = SignalProcessor(quick_llm)
        host.deep_thinking_llm = deep_llm
        host.quick_thinking_llm = quick_llm
        host.signal_processor = self.signal_processor
        host.graph_setup.quick_thinking_llm = quick_llm
        host.graph_setup.deep_thinking_llm = deep_llm
