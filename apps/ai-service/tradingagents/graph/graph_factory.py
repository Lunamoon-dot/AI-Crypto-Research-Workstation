"""LangGraph construction boundary."""

from __future__ import annotations

from typing import Any

from .conditional_logic import ConditionalLogic
from .setup import DEFAULT_ANALYSTS, GraphSetup


class GraphFactory:
    """Builds and compiles the research LangGraph."""

    def __init__(
        self,
        *,
        quick_thinking_llm: Any,
        deep_thinking_llm: Any,
        tool_nodes: dict[str, Any],
        conditional_logic: ConditionalLogic,
        config: dict[str, Any],
        budget_tracker: Any,
        llm_orchestrator: Any | None = None,
    ) -> None:
        self.graph_setup = GraphSetup(
            quick_thinking_llm,
            deep_thinking_llm,
            tool_nodes,
            conditional_logic,
            config=config,
            budget_tracker=budget_tracker,
            llm_orchestrator=llm_orchestrator,
        )

    def build_workflow(self, selected_analysts):
        analysts = DEFAULT_ANALYSTS if selected_analysts is None else selected_analysts
        return self.graph_setup.setup_graph(analysts)

    @staticmethod
    def compile(workflow, *, checkpointer=None):
        if checkpointer is not None:
            return workflow.compile(checkpointer=checkpointer)
        return workflow.compile()
