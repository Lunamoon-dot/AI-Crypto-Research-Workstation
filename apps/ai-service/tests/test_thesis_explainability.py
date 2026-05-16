from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from tradingagents.agents.utils.rating import DecisionConsistencyError
from tradingagents.domain import (
    AgentOpinion,
    AgentStance,
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
            "final_trade_decision": "**Rating**: Sell\n\n**Investment Thesis**: Wait.",
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
    assert thesis.confidence == 0.45
    assert thesis.structured_summary.rating == "Sell"
    assert thesis.structured_summary.action_summary == "Fade failed reclaim"
    assert thesis.entry_zone == "Failed reclaim near 100000"
    assert thesis.target_zones == ["92000", "88000"]
    assert thesis.invalidation == "Close above 105000"
    assert thesis.structured_summary is not None
    assert thesis.structured_summary.is_degraded is True
    assert thesis.structured_summary.market_type == "perp"
    assert (
        thesis.structured_summary.perp_notes
        == "Funding is elevated; cap leverage at 2x."
    )
    assert thesis.structured_summary.missing_data == ["liquidation heatmap"]
    assert "missing_liquidations" in thesis.structured_summary.missing_data_reason_codes


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
                "**Rating**: Underweight\n\n"
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

    assert thesis.direction == ThesisDirection.AVOID
    assert thesis.thesis_text == (
        "**Rating**: Underweight\n\n**Executive Summary**: Wait for confirmation."
    )
    assert thesis.structured_summary is not None
    assert thesis.structured_summary.rating == "Underweight"
    assert thesis.structured_summary.direction == ThesisDirection.AVOID
    assert thesis.structured_summary.confidence == 0.24
    assert thesis.structured_summary.action_summary == (
        "Trim 25-50%; do not open new longs"
    )
    assert thesis.structured_summary.risks == ["Missing liquidation data"]


def test_graph_rejects_mismatched_official_rating_fields():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "SOL/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.24)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_bad", symbol="SOL/USDT")
    graph.current_signals = []

    with pytest.raises(DecisionConsistencyError):
        ResearchAgentsGraph._build_trade_thesis(
            graph,
            {
                "final_trade_decision": "**Rating**: Overweight\n\nAvoid.",
                "final_trade_summary_json": '{"rating": "Underweight"}',
            },
        )


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
    assert thesis.structured_summary.data_quality_label == "clean"


def test_degraded_run_caps_pm_confidence_and_surfaces_reason_codes():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(
        id="run_degraded",
        symbol="BTC/USDT",
        status="completed_degraded",
        degradation_reasons=["missing_news"],
        missing_optional_data=["missing liquidation heatmap"],
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if flows hold.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive, but missing data weakens confidence",
              "entry_zone": "Pullback near 100000",
              "invalidation": "Close below 95000",
              "target_zones": ["110000"],
              "missing_data": ["missing liquidation heatmap"],
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.direction == ThesisDirection.LONG
    assert thesis.confidence == 0.45
    assert thesis.structured_summary.is_degraded is True
    assert thesis.structured_summary.data_quality_label == "degraded"
    assert "missing_news_feed" in thesis.structured_summary.missing_data_reason_codes
    assert "missing_liquidations" in thesis.structured_summary.missing_data_reason_codes


def test_news_opinion_missing_feed_caps_data_quality_and_merges_summary_codes():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = [
        AgentOpinion(
            agent_name="Market Analyst",
            role="market_analyst",
            stance=AgentStance.BULLISH,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="Sentiment Analyst",
            role="sentiment_analyst",
            stance=AgentStance.NEUTRAL,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="Onchain Analyst",
            role="onchain_analyst",
            stance=AgentStance.BULLISH,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="News Analyst",
            role="news_analyst",
            stance=AgentStance.UNCERTAIN,
            data_quality=0.0,
            missing_data=[
                "insufficient_news_evidence",
                "missing primary-source crypto headlines",
            ],
            reason_codes=["missing_news_feed"],
        ),
    ]
    graph.current_research_run = ResearchRun(id="run_news_missing", symbol="BTC/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if flows hold.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive, but news feed is missing",
              "entry_zone": "Pullback near 100000",
              "invalidation": "Close below 95000",
              "target_zones": ["110000"],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert thesis.confidence == 0.25
    assert summary.data_quality == 0.34
    assert summary.data_quality_label == "insufficient_data"
    assert "missing_news_feed" in summary.missing_data_reason_codes
    assert "insufficient_news_evidence" in summary.missing_data_reason_codes
    assert "insufficient_news_evidence" in summary.missing_data
    assert "missing primary-source crypto headlines" in summary.missing_data


def test_onchain_opinion_missing_flows_caps_data_quality_to_degraded():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "ETH/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = [
        AgentOpinion(
            agent_name="Market Analyst",
            role="market_analyst",
            stance=AgentStance.BULLISH,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="Sentiment Analyst",
            role="sentiment_analyst",
            stance=AgentStance.BULLISH,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="News Analyst",
            role="news_analyst",
            stance=AgentStance.NEUTRAL,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="Onchain Analyst",
            role="onchain_analyst",
            stance=AgentStance.UNCERTAIN,
            data_quality=1.0,
            missing_data=["exchange flow data unavailable"],
            reason_codes=["missing_onchain_flows"],
        ),
    ]
    graph.current_research_run = ResearchRun(
        id="run_onchain_missing",
        symbol="ETH/USDT",
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "ETH/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if flows hold.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive, but onchain flow is missing",
              "entry_zone": "Pullback near 3150",
              "invalidation": "Close below 3000",
              "target_zones": ["3500"],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert thesis.confidence == 0.45
    assert summary.data_quality == 0.6
    assert summary.data_quality_label == "degraded"
    assert "missing_onchain_flows" in summary.missing_data_reason_codes
    assert "exchange flow data unavailable" in summary.missing_data


def test_low_quant_confidence_caps_high_pm_confidence_as_watch_memo():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "ETH/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(
        confidence=0.15,
        current_price=3200.0,
        score=SimpleNamespace(value="Neutral"),
    )
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_low_quant", symbol="ETH/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "ETH/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if flows hold.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive, but quant confidence is weak",
              "entry_zone": "Pullback near 3150",
              "invalidation": "Close below 3000",
              "target_zones": ["3500"],
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.confidence == 0.25
    assert thesis.evidence["confidence_source"] == "portfolio_manager_low_quant_capped"
    assert "watch/risk memo" in thesis.confidence_rationale
    assert any("watch/risk memo" in risk for risk in thesis.risk_notes)


def test_mtf_alignment_conflict_penalizes_final_confidence():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(
        confidence=0.8,
        current_price=100000.0,
        score=SimpleNamespace(value="Buy"),
    )
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_mtf", symbol="BTC/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "market_report": """
            Multi-Timeframe Analysis for BTC/USDT
            Trend Summary:
              DAILY    bullish (strength: 80%, slope: +4.0%)
              WEEKLY   bullish (strength: 45%, slope: +2.2%)
              MONTHLY  neutral (strength: 30%, slope: +0.4%)
            Alignment Score: 56/100
            Verdict: Mixed
            """,
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive only on confirmation.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.80,
              "action_summary": "Constructive only on confirmation",
              "entry_zone": "Break above 103000",
              "invalidation": "Close below 96000",
              "target_zones": ["110000"],
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.confidence == 0.70
    assert thesis.evidence["confidence_source"] == "portfolio_manager_mtf_penalized"
    assert thesis.evidence["mtf_confidence_penalty"]["alignment_score"] == 56.0
    assert any("Multi-timeframe alignment 56/100" in risk for risk in thesis.risk_notes)


def test_graph_adds_price_sanity_note_when_trigger_already_crossed():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BNB/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.3, current_price=682.0)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_price", symbol="BNB/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BNB/USDT",
            "final_trade_decision": (
                "**Rating**: Hold\n\nBreak above $638 with volume and RSI confirmation."
            ),
            "final_trade_summary_json": """
            {
              "rating": "Hold",
              "direction": "watch",
              "confidence": 0.3,
              "action_summary": "Wait for confirmation",
              "entry_zone": "Break above $638 with volume",
              "invalidation": "Close below $620",
              "target_zones": ["$700"],
              "market_type": "spot"
            }
            """,
        },
    )

    note = "price-only above $638 has already occurred at current price $682"
    assert any(note in risk for risk in thesis.risk_notes)
    assert thesis.evidence["current_price"] == 682.0


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
    graph.journal_bridge = SimpleNamespace(service=_ThesisMemoryService([previous]))
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
