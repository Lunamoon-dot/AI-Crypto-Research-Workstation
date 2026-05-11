from types import SimpleNamespace

from tradingagents.domain import (
    DataFreshness,
    ResearchRun,
    Signal,
    SignalDirection,
    SignalProvenance,
)
from tradingagents.graph.research_agents_graph import ResearchAgentsGraph


def test_graph_builds_explicit_thesis_explainability_fields():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Buy")
    graph.quant_signal_result = SimpleNamespace(confidence=0.72)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_1", symbol="BTC/USDT")
    graph.current_signals = [
        Signal(
            id="sig_support",
            symbol="BTC/USDT",
            signal_type="regime",
            direction=SignalDirection.BULLISH,
            summary="Market regime supports continuation.",
            provenance=SignalProvenance(source="signal_engine"),
        ),
        Signal(
            id="sig_contra",
            symbol="BTC/USDT",
            signal_type="funding",
            direction=SignalDirection.BEARISH,
            summary="Funding is overheated.",
            provenance=SignalProvenance(
                source="funding",
                freshness=DataFreshness.STALE,
            ),
        ),
    ]

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "final_trade_decision": (
                "Buy while reclaim holds.\n"
                "Entry: 100000\n"
                "Invalidation: 95000\n"
                "Target: 110000, 120000"
            )
        },
    )

    assert thesis.why_this_thesis == "Buy while reclaim holds."
    assert thesis.supporting_evidence == ["Market regime supports continuation."]
    assert thesis.contradicting_evidence == ["Funding is overheated."]
    assert thesis.stale_or_missing_data == ["regime: unknown", "funding: stale"]
    assert thesis.invalidation == "95000"
    assert "target: 110000" in thesis.monitor_next
    assert "0.72" in thesis.confidence_rationale
