from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from tradingagents.domain import (
    DataFreshness,
    ResearchRun,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
    TradeThesis,
    TradeThesisStructuredSummary,
)
from tradingagents.graph.research_agents_graph import ResearchAgentsGraph


class _ThesisMemoryService:
    def __init__(self, theses):
        self._theses = theses

    def list_theses(self, *, limit=20):
        return self._theses[:limit]


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
    assert thesis.structured_summary.missing_data == [
        "regime: unknown",
        "funding: stale",
    ]


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
    assert (
        thesis.structured_summary.perp_notes
        == "Funding is elevated; cap leverage at 2x."
    )
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


def test_graph_uses_debate_confidence_when_pm_confidence_missing():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "SOL/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(
        confidence=0.08,
        score=SimpleNamespace(value="neutral"),
    )
    graph.current_debate = SimpleNamespace(consensus_confidence=0.62)
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_3", symbol="SOL/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "final_trade_decision": "**Rating**: Underweight\n\nAvoid fresh longs.",
            "final_trade_summary_json": """
            {
              "rating": "Underweight",
              "direction": "avoid",
              "confidence": null,
              "action_summary": "Avoid fresh longs",
              "entry_zone": "No new entry",
              "invalidation": "Close above 110",
              "target_zones": ["92", "84"],
              "risks": ["Positive catalyst risk"],
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.confidence == 0.57
    assert thesis.heuristic_confidence == 0.57
    assert thesis.evidence["confidence_source"] == "debate_consensus"
    assert thesis.evidence["quant_confidence"] == 0.08
    assert thesis.evidence["quant_bias"] == "neutral"
    assert "source=debate_consensus" in thesis.confidence_rationale
    assert "quant confidence=0.08" in thesis.confidence_rationale


def test_graph_stability_guard_holds_recent_same_symbol_flip():
    now = datetime.now(timezone.utc)
    previous = TradeThesis(
        id="thesis_prev",
        research_run_id="run_prev",
        workspace_id="local",
        symbol="SOL/USDT",
        direction=ThesisDirection.LONG,
        confidence=0.60,
        heuristic_confidence=0.60,
        thesis_text="Long while flag support holds.",
        entry_zone="$92-$94",
        invalidation_level="Daily close below $87.50",
        invalidation="Daily close below $87.50",
        target_zones=["$100", "$108"],
        monitor_next=["invalidation: Daily close below $87.50"],
        structured_summary=TradeThesisStructuredSummary(
            rating="Overweight",
            direction="long",
            confidence=0.60,
            action_summary="Long while flag support holds.",
            entry_zone="$92-$94",
            invalidation="Daily close below $87.50",
            target_zones=["$100", "$108"],
        ),
        created_at=now - timedelta(minutes=16),
    )

    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "SOL/USDT"
    graph.config = {
        "thesis_stability": {
            "enabled": True,
            "cooldown_minutes": 60,
            "max_confidence_delta": 0.20,
            "flip_override_confidence": 0.75,
            "memory_limit": 10,
        }
    }
    graph.journal_bridge = SimpleNamespace(
        service=_ThesisMemoryService([previous])
    )
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.25)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(
        id="run_new",
        symbol="SOL/USDT",
        workspace_id="local",
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "final_trade_decision": "Hold; wait for confirmation.",
            "final_trade_summary_json": """
            {
              "rating": "Hold",
              "direction": "watch",
              "confidence": 0.25,
              "action_summary": "Wait; bullish follow-through faded",
              "invalidation": "Structural bearish break below $81",
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.direction == ThesisDirection.LONG
    assert thesis.confidence == 0.60
    assert thesis.structured_summary.rating == "Overweight"
    assert thesis.structured_summary.action_summary == "Long while flag support holds."
    assert thesis.invalidation_level == "Daily close below $87.50"
    assert thesis.evidence["stability_guard"]["applied"] is True
    assert thesis.evidence["stability_guard"]["proposed"]["direction"] == "watch"
    assert thesis.evidence["stability_guard"]["proposed"]["confidence"] == 0.25
