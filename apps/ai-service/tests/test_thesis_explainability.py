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
    graph.current_research_run = ResearchRun(
        id="run_1",
        symbol="BTC/USDT",
        market_type="perp",
    )
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
    assert thesis.structured_summary.is_degraded is True
    assert "structured_summary_missing" in thesis.structured_summary.degradation_reasons
    assert "entry_zone_from_prose" in thesis.structured_summary.degradation_reasons
    assert thesis.structured_summary.market_type == "perp"
    assert thesis.structured_summary.missing_data == ["regime: unknown", "funding: stale"]


def test_graph_builds_thesis_from_structured_summary_json_first():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.5)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(
        id="run_1",
        symbol="BTC/USDT",
        workspace_id="workspace_1",
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Hold\n\n**Investment Thesis**: Wait.",
            "final_trade_summary_json": """
            {
              "rating": "Sell",
              "direction": "short",
              "confidence": 0.81,
              "action_summary": "Fade failed reclaim",
              "entry_zone": "Failed reclaim near 100000",
              "invalidation": "Close above 105000",
              "target_zones": ["92000", "88000"],
              "risks": ["Squeeze risk"],
              "market_type": "perp",
              "perp_notes": "Funding is elevated; cap leverage at 2x.",
              "missing_data": ["liquidation heatmap"]
            }
            """,
        },
    )

    assert thesis.workspace_id == "workspace_1"
    assert thesis.direction.value == "short"
    assert thesis.confidence == 0.81
    assert thesis.structured_summary.rating == "Sell"
    assert thesis.structured_summary.action_summary == "Fade failed reclaim"
    assert thesis.entry_zone == "Failed reclaim near 100000"
    assert thesis.target_zones == ["92000", "88000"]
    assert thesis.invalidation == "Close above 105000"
    assert thesis.structured_summary is not None
    assert thesis.structured_summary.is_degraded is False
    assert thesis.structured_summary.market_type == "perp"
    assert thesis.structured_summary.perp_notes == "Funding is elevated; cap leverage at 2x."
    assert thesis.structured_summary.missing_data == ["liquidation heatmap"]


def test_graph_prefers_validated_summary_json_and_strips_it_from_thesis_text():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "SOL/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.24)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_2", symbol="SOL/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "final_trade_decision": (
                "**Rating**: Hold\n\n"
                "**Executive Summary**: Wait for confirmation.\n\n"
                "TRADE_THESIS_JSON:\n"
                "```json\n"
                "{\n"
                '  "rating": "Underweight",\n'
                '  "direction": "short",\n'
                '  "confidence": "24%",\n'
                '  "action_summary": "Trim 25-50%; do not open new longs",\n'
                '  "upside_catalyst": "Break above $100 with volume",\n'
                '  "invalidation": "Close below $90",\n'
                '  "key_reasons": ["Neutral signal with low confidence"],\n'
                '  "risks": ["Missing liquidation data"],\n'
                "}\n"
                "```"
            )
        },
    )

    assert thesis.direction == "short"
    assert thesis.thesis_text == (
        "**Rating**: Hold\n\n**Executive Summary**: Wait for confirmation."
    )
    assert thesis.structured_summary is not None
    assert thesis.structured_summary.rating == "Underweight"
    assert thesis.structured_summary.direction == "short"
    assert thesis.structured_summary.confidence == 0.24
    assert thesis.structured_summary.action_summary == (
        "Trim 25-50%; do not open new longs"
    )
    assert thesis.structured_summary.risks == ["Missing liquidation data"]
