from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from luna_workstation.agents.utils.rating import DecisionConsistencyError
from luna_workstation.domain import (
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
from luna_workstation.graph.opinions import opinion_from_text
from luna_workstation.graph.research_agents_graph import ResearchAgentsGraph
from luna_workstation.graph.thesis_builder import extract_thesis_field


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


def test_extract_thesis_field_ignores_combined_confirmation_invalidation_heading():
    text = "\n".join(
        [
            "Final Research Thesis: BNB/USDT (Spot)",
            "",
            "Confirmation & Invalidation",
            "Invalidation: at $700 (8.5% rally).",
        ]
    )

    assert extract_thesis_field(text, "confirmation") is None
    assert extract_thesis_field(text, "invalidation") == "at $700 (8.5% rally)."


def test_extract_thesis_field_reads_vietnamese_multiline_review_sections():
    text = "\n".join(
        [
            "Final Research Thesis: BNB/USDT (Spot)",
            "",
            "**Dieu kien xac nhan luan diem bear (khi nao Underweight co hieu luc?)**",
            "- Gia dong cua duoi $550 xac nhan xu huong giam sau hon.",
            "- Long/Short van duy tri tren 2.0 va khoi luong ban tiep tuc cao.",
            "",
            "**Dieu kien lam suy yeu luan diem (khi nao can xem xet lai?)**",
            "- Gia dong cua tren $600 voi khoi luong tang dot bien.",
            "- Xuat hien chat xuc tac tich cuc.",
            "",
            "### Rui ro chinh",
            "- Short squeeze risk.",
        ]
    )

    assert extract_thesis_field(text, "confirmation") == (
        "Gia dong cua duoi $550 xac nhan xu huong giam sau hon.; "
        "Long/Short van duy tri tren 2.0 va khoi luong ban tiep tuc cao."
    )
    assert extract_thesis_field(text, "invalidation") == (
        "Gia dong cua tren $600 voi khoi luong tang dot bien.; "
        "Xuat hien chat xuc tac tich cuc."
    )

    accented_text = "\n".join(
        [
            "**Điều kiện xác nhận luận điểm bear**",
            "- Giá đóng cửa dưới $550 xác nhận xu hướng giảm.",
            "",
            "**Điều kiện làm suy yếu luận điểm**",
            "- Giá đóng cửa trên $600 với khối lượng tăng.",
        ]
    )
    assert extract_thesis_field(accented_text, "confirmation") == (
        "Giá đóng cửa dưới $550 xác nhận xu hướng giảm."
    )
    assert extract_thesis_field(accented_text, "invalidation") == (
        "Giá đóng cửa trên $600 với khối lượng tăng."
    )



def test_extract_thesis_field_reads_vietnamese_inline_review_sections():
    text = "\n".join(
        [
            "**Xac nhan luan diem:** Daily close above $96,000 with volume.",
            "",
            "**Dieu kien vo hieu:** Close above $98,500 with strong buy volume.",
        ]
    )

    assert (
        extract_thesis_field(text, "confirmation")
        == "Daily close above $96,000 with volume."
    )
    assert (
        extract_thesis_field(text, "invalidation")
        == "Close above $98,500 with strong buy volume."
    )


def test_graph_builds_thesis_from_generic_fenced_json_summary():
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
            "final_trade_decision": """
            **Stance: Underweight**

            **Xac nhan luan diem:** Sideway weak until reversal confirms.

            ```json
            {
              "rating": "Underweight",
              "direction": "avoid",
              "confidence": 0.65,
              "market_type": "spot",
              "action_summary": "Avoid new longs.",
              "confirmation_condition": "Daily close above $96,000 with volume.",
              "invalidation": "Close above $98,500 with strong buy volume.",
              "key_reasons": [
                {
                  "text": "Trend remains bearish.",
                  "supporting_evidence": [
                    {
                      "text": "Signal engine trend is bearish.",
                      "evidence_kind": "observed",
                      "source_artifact": "research_plan",
                      "source_field": "trend",
                      "strength": "high"
                    }
                  ]
                }
              ]
            }
            ```
            """,
        },
    )

    assert thesis.confirmation_condition == "Daily close above $96,000 with volume."
    assert thesis.invalidation == "Close above $98,500 with strong buy volume."
    assert thesis.structured_summary.confirmation_condition == (
        "Daily close above $96,000 with volume."
    )
    assert thesis.structured_summary.invalidation == (
        "Close above $98,500 with strong buy volume."
    )
    assert "confirmation_condition_missing_from_structured_summary" not in (
        thesis.structured_summary.degradation_reasons
    )


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
              "confirmation_condition": "Bearish thesis confirms if BTC rejects 100000 with rising sell volume",
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
    assert thesis.confirmation_condition == (
        "Bearish thesis confirms if BTC rejects 100000 with rising sell volume"
    )
    assert thesis.structured_summary.confirmation_condition == (
        "Bearish thesis confirms if BTC rejects 100000 with rising sell volume"
    )
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


def test_structured_summary_derives_decision_semantics_from_legacy_fields():
    summary = TradeThesisStructuredSummary.model_validate(
        {
            "rating": "Underweight",
            "direction": "avoid",
            "action_summary": "Reduce exposure and avoid initiating fresh longs.",
            "entry_zone": "",
        }
    )

    assert summary.recommended_action == "avoid_long"
    assert summary.market_bias == "defensive"
    assert summary.entry_plan_status == "no_trade"


def test_structured_summary_preserves_explicit_decision_semantics():
    summary = TradeThesisStructuredSummary.model_validate(
        {
            "rating": "Hold",
            "direction": "watch",
            "recommended_action": "reduce_exposure",
            "market_bias": "defensive",
            "entry_plan_status": "no_trade",
        }
    )

    assert summary.recommended_action == "reduce_exposure"
    assert summary.market_bias == "defensive"
    assert summary.entry_plan_status == "no_trade"


def test_graph_preserves_object_first_research_evidence_contract():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.5)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(
        id="run_evidence_contract",
        symbol="BTC/USDT",
        workspace_id="workspace_1",
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if reclaim holds.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.66,
              "action_summary": "Constructive while reclaim holds",
              "entry_zone": "Pullback near support",
              "confirmation_condition": "Daily close above resistance with expanding spot volume",
              "invalidation": "Close back below support",
              "target_zones": ["range high"],
              "key_reasons": [
                {
                  "text": "Market structure improved after reclaiming the prior range.",
                  "supporting_evidence": [
                    {
                      "text": "BTC reclaimed the prior range and held above it into close.",
                      "evidence_kind": "observed",
                      "source_artifact": "market_snapshot",
                      "source_field": "payload.market_structure",
                      "strength": "medium"
                    }
                  ],
                  "confidence": "medium"
                }
              ],
              "risks": [
                {
                  "text": "Funding data is unavailable for this run.",
                  "supporting_evidence": [
                    {
                      "message": "Funding feed was unavailable during collection.",
                      "evidence_kind": "missing",
                      "source_artifact": "research_run"
                    },
                    {
                      "evidence_kind": "observed",
                      "source_artifact": "market_snapshot"
                    }
                  ],
                  "severity": "medium"
                }
              ],
              "monitor_next": [
                {
                  "text": "Watch whether BTC accepts above resistance.",
                  "supporting_evidence": [
                    {
                      "text": "Prior rejection zone remains overhead.",
                      "evidence_kind": "invalid-kind",
                      "source_artifact": "funding_feed",
                      "strength": "high"
                    }
                  ],
                  "trigger": "daily close above resistance"
                }
              ],
              "supporting_evidence": [
                {
                  "text": "Portfolio manager synthesis favors patience until confirmation.",
                  "evidence_kind": "reasoning",
                  "source_artifact": "trade_thesis"
                }
              ],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert summary is not None
    payload = summary.model_dump(mode="json")
    assert payload["key_reasons"][0]["text"] == (
        "Market structure improved after reclaiming the prior range."
    )
    assert payload["key_reasons"][0]["supporting_evidence"] == [
        {
            "text": "BTC reclaimed the prior range and held above it into close.",
            "evidence_kind": "observed",
            "source_artifact": "market_snapshot",
            "source_id": None,
            "source_field": "payload.market_structure",
            "evidence_type": None,
            "strength": "medium",
        }
    ]
    assert payload["risks"][0]["supporting_evidence"] == [
        {
            "text": "Funding feed was unavailable during collection.",
            "evidence_kind": "missing",
            "source_artifact": "research_run",
            "source_id": None,
            "source_field": None,
            "evidence_type": None,
            "strength": None,
        }
    ]
    assert payload["monitor_next"][0]["supporting_evidence"][0] == {
        "text": "Prior rejection zone remains overhead.",
        "evidence_kind": "reasoning",
        "source_artifact": "unknown",
        "source_id": None,
        "source_field": None,
        "evidence_type": None,
        "strength": "high",
    }
    assert payload["supporting_evidence"][0]["evidence_kind"] == "reasoning"
    assert thesis.monitor_next == [
        "Watch whether BTC accepts above resistance.",
        "entry: Pullback near support",
        "confirmation: Daily close above resistance with expanding spot volume",
        "invalidation: Close back below support",
        "target: range high",
    ]
    assert thesis.risk_notes == ["Funding data is unavailable for this run."]


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
              "confirmation_condition": "Daily rejection below 110 confirms continued avoidance",
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


def test_news_opinion_missing_feed_degrades_quality_without_flat_insufficient_cap():
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
    assert thesis.confidence == 0.45
    assert summary.data_quality == 0.6
    assert summary.data_quality_label == "degraded"
    assert "missing_news_feed" in summary.missing_data_reason_codes
    assert "insufficient_news_evidence" in summary.missing_data_reason_codes
    assert "insufficient_news_evidence" in summary.missing_data
    assert "missing primary-source crypto headlines" in summary.missing_data


def test_sentiment_missing_news_feed_does_not_apply_news_insufficient_cap():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "ETH/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = [
        AgentOpinion(
            agent_name="News Analyst",
            role="news_analyst",
            stance=AgentStance.BULLISH,
            data_quality=0.88,
            data_quality_label="clean",
            raw_text=(
                "===== PRE-COMPUTED NEWS CONTEXT =====\n"
                "Quality: clean (0.88)\n"
                "Confirmed Primary-Source Items:\n"
                "- Title: Ethereum Foundation security update; "
                "URL: https://blog.ethereum.org/example; "
                "Published: 2026-05-31T00:00:00Z\n"
                "===== END NEWS CONTEXT ====="
            ),
        ),
        AgentOpinion(
            agent_name="Sentiment Analyst",
            role="sentiment_analyst",
            stance=AgentStance.UNCERTAIN,
            data_quality=1.0,
            missing_data=["No third-party crypto news feed / unsupported by workspace"],
            reason_codes=["missing_news_feed"],
        ),
    ]
    graph.current_research_run = ResearchRun(
        id="run_sentiment_missing", symbol="ETH/USDT"
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "ETH/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if support holds.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive while support holds",
              "entry_zone": "$1,990-$2,020",
              "invalidation": "Close below $1,930",
              "target_zones": ["$2,200-$2,280"],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert summary.data_quality > 0.34
    assert summary.data_quality_label != "insufficient_data"
    assert thesis.confidence != 0.25


def test_social_missing_feed_caps_social_evidence_without_news_reason_code():
    opinion = opinion_from_text(
        "Sentiment Analyst",
        "Quality: insufficient_data\nMissing/degraded data:\n- missing_social_feed",
        research_run_id="run_1",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    assert opinion is not None
    assert "missing_social_feed" in opinion.reason_codes
    assert "missing_news_feed" not in opinion.reason_codes


def test_spot_onchain_opinion_missing_flows_remains_optional():
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
              "confirmation_condition": "Daily acceptance above 3300 with spot volume expansion",
              "invalidation": "Close below 3000",
              "target_zones": ["3500"],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert thesis.confidence == 0.82
    assert summary.data_quality >= 0.75
    assert summary.data_quality_label == "clean"
    assert "missing_onchain_flows" in summary.missing_data_reason_codes
    assert "exchange flow data unavailable" in summary.missing_data


def test_graph_fills_missing_structured_entry_and_targets_from_pm_prose():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "ETH/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(id="run_prose_zones", symbol="ETH/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "ETH/USDT",
            "final_trade_decision": (
                "**Rating**: Overweight\n\n"
                "Portfolio Manager plan.\n"
                "Confirmation: 4H close back above $2,050 with expanding spot volume\n"
                "Entry Zone: $1,990-$2,020\n"
                "Invalidation: Close below $1,930\n"
                "Target zones: $2,200-$2,280"
            ),
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive while support holds",
              "invalidation": "Close below $1,930",
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.entry_zone == "$1,990-$2,020"
    assert thesis.confirmation_condition == (
        "4H close back above $2,050 with expanding spot volume"
    )
    assert thesis.structured_summary.confirmation_condition == (
        "4H close back above $2,050 with expanding spot volume"
    )
    assert thesis.target_zones == ["$2,200-$2,280"]
    assert thesis.structured_summary.entry_zone == "$1,990-$2,020"
    assert thesis.structured_summary.target_zones == ["$2,200-$2,280"]
    assert "entry_zone_missing_from_structured_summary" not in (
        thesis.structured_summary.degradation_reasons
    )
    assert "confirmation_condition_missing_from_structured_summary" not in (
        thesis.structured_summary.degradation_reasons
    )
    assert "target_zones_missing_from_structured_summary" not in (
        thesis.structured_summary.degradation_reasons
    )


def test_spot_optional_derivatives_and_onchain_gaps_do_not_heavily_cap_thesis():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "ETH/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = ResearchRun(
        id="run_spot_optional_missing",
        symbol="ETH/USDT",
        market_type="spot",
        degradation_reasons=[
            "missing_funding_rate",
            "missing_liquidations",
            "missing_onchain_flows",
        ],
        missing_optional_data=[
            "missing_funding_rate",
            "missing_liquidations",
            "missing_onchain_flows",
        ],
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "ETH/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if support holds.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive while support holds",
              "entry_zone": "$1,990-$2,020",
              "confirmation_condition": "4H close back above $2,050 with expanding spot volume",
              "invalidation": "Close below $1,930",
              "target_zones": ["$2,200-$2,280"],
              "market_type": "spot"
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert summary.data_quality_label == "clean"
    assert summary.data_quality >= 0.75
    assert thesis.confidence > 0.45
    assert "missing_funding_rate" in summary.missing_data_reason_codes
    assert "missing_liquidations" in summary.missing_data_reason_codes
    assert "missing_onchain_flows" in summary.missing_data_reason_codes


def test_thesis_reason_codes_filter_llm_prose_and_primary_source_noise():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = [
        AgentOpinion(
            agent_name="Sentiment Analyst",
            role="sentiment_analyst",
            stance=AgentStance.UNCERTAIN,
            data_quality=1.0,
            missing_data=[
                "The sentiment analyst said no strong bullish or bearish social "
                "signal and flagged missing polarity data.",
                "Missing the first 5% move is a small price to pay for avoiding a "
                "10-15% drawdown.",
            ],
            source_report_type="sentiment",
        )
    ]
    graph.current_research_run = ResearchRun(
        id="run_noisy_reason_codes",
        symbol="BTC/USDT",
        market_type="spot",
        status="completed_degraded",
        degradation_reasons=[
            "missing_primary_source_news",
            "missing_liquidations",
            "missing_onchain_flows",
            "missing_funding_rate",
            "missing_news_feed",
            "insufficient_news_evidence",
            "exchange_oi_unsupported",
            "missing_data",
            "missing_data_conflicts",
            "single_source_concentration_all_6_articles_from_coindesk_no_bloomberg_reuters_decrypt_or_the_block_cross_check",
            "missing_workspace_sources_and_targeted_search",
            "missing_primary_source_crypto_headlines",
            "data_quality",
            "but_here_s_what_you_re_missing",
            "the_risk_of_missing_a_violent_reversal_is_far_greater_than_the_risk_of_a_small_drawdown",
            "you_mention_shorts_piling_on_after_the_ibit_outflow_but_there_s_no_data_confirming_that",
            "supporting_evidence",
            "text",
        ],
        missing_optional_data=[
            "missing_liquidations",
            "missing_onchain_flows",
            "missing_funding_rate",
            "exchange_oi_unsupported",
        ],
    )
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Hold\n\nWait for confirmation.",
            "final_trade_summary_json": """
            {
              "rating": "Hold",
              "direction": "watch",
              "confidence": 0.62,
              "action_summary": "Wait for confirmation",
              "entry_zone": "$104,000-$106,000",
              "confirmation_condition": "Daily close back above $108,000",
              "invalidation": "Close below $101,000",
              "target_zones": ["$112,000-$115,000"],
              "market_type": "spot",
              "missing_data": [
                "But here's what you're missing",
                "weekly trend ADX / MA slope values, exact order book depth per level, and a macro event calendar e.g. FOMC are unavailable"
              ],
              "missing_data_reason_codes": [
                "missing_primary_source_news",
                "missing_news_feed",
                "insufficient_news_evidence",
                "missing_data",
                "data_quality",
                "supporting_evidence",
                "text"
              ]
            }
            """,
        },
    )

    summary = thesis.structured_summary
    assert summary.missing_data_reason_codes == [
        "missing_news_feed",
        "insufficient_news_evidence",
        "missing_social_feed",
        "missing_liquidations",
        "missing_onchain_flows",
        "missing_funding_rate",
        "exchange_oi_unsupported",
        "single_source_concentration",
        "workspace_news_source_unavailable",
    ]
    assert "missing_primary_source_news" not in summary.missing_data_reason_codes
    assert "but_here_s_what_you_re_missing" not in summary.degradation_reasons
    assert "data_quality" not in summary.degradation_reasons
    assert "supporting_evidence" not in summary.degradation_reasons
    assert "text" not in summary.degradation_reasons
    assert "missing_liquidations" not in summary.degradation_reasons
    assert "missing_funding_rate" not in summary.degradation_reasons


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
              "confirmation_condition": "Daily close above 3300 with improving quant confirmation",
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
              "confirmation_condition": "Daily close above 103000 with weekly structure holding bullish",
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
