"""Service boundary for running research graph workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from luna_workstation.default_config import DEFAULT_CONFIG


@dataclass(frozen=True)
class ResearchRunResult:
    """Result returned by a completed research graph run."""

    final_state: dict[str, Any]
    decision: str
    graph: Any


class ResearchService:
    """Thin application service around the research graph implementation."""

    def __init__(self, graph_class: Callable[..., Any] | None = None) -> None:
        if graph_class is None:
            from luna_workstation.graph import ResearchAgentsGraph

            graph_class = ResearchAgentsGraph
        self._graph_class = graph_class

    def create_graph(
        self,
        selected_analyst_keys: list[str],
        *,
        config: dict[str, Any],
        debug: bool = True,
        callbacks: list[Any] | None = None,
    ) -> Any:
        """Create the concrete graph used for one research run."""
        return self._graph_class(
            selected_analyst_keys,
            config=config,
            debug=debug,
            callbacks=callbacks,
        )

    def run(
        self,
        *,
        ticker: str,
        analysis_date: str,
        selected_analyst_keys: list[str],
        config: dict[str, Any],
        callbacks: list[Any] | None = None,
        node_callback: Callable[[dict[str, Any]], None] | None = None,
        run_callbacks: list[Any] | None = None,
        debug: bool = True,
    ) -> ResearchRunResult:
        """Run the research graph and return the final state, decision, and graph."""
        graph = self.create_graph(
            selected_analyst_keys,
            config=config,
            debug=debug,
            callbacks=callbacks,
        )
        final_state, decision = graph.propagate(
            ticker,
            analysis_date,
            node_callback=node_callback,
            run_callbacks=run_callbacks,
        )
        return ResearchRunResult(
            final_state=final_state, decision=decision, graph=graph
        )

    def clear_checkpoints(self, data_cache_dir: str | None = None) -> int:
        """Clear persisted graph checkpoints for the configured research cache."""
        from luna_workstation.graph.checkpointer import clear_all_checkpoints

        cache_dir = data_cache_dir or DEFAULT_CONFIG["data_cache_dir"]
        return clear_all_checkpoints(cache_dir)
