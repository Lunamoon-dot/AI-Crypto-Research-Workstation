from dataclasses import dataclass
from unittest.mock import MagicMock

from tradingagents.agents.utils.agent_utils import create_analyst_opinion_builder
from tradingagents.domain import AgentOpinion, AgentStance
from tradingagents.graph.opinions import build_agent_opinions, opinion_from_text
from tradingagents.graph.analyst_runtime import make_analyst_runner
from tradingagents.graph.setup import ANALYST_DEFINITIONS, DEFAULT_ANALYSTS


@dataclass
class FakeMessage:
    content: str
    tool_calls: list


class FakeToolNode:
    def __init__(self):
        self.calls = 0

    def invoke(self, _state):
        self.calls += 1
        return {"messages": [FakeMessage(content="tool-result", tool_calls=[])]}


def test_analyst_runner_completes_local_tool_loop():
    tool_node = FakeToolNode()
    call_counter = {"n": 0}

    def analyst_node(_state):
        call_counter["n"] += 1
        if call_counter["n"] == 1:
            return {
                "market_report": "",
                "messages": [
                    FakeMessage(content="need tool", tool_calls=[{"name": "x"}])
                ],
            }
        return {
            "market_report": "done",
            "messages": [FakeMessage(content="final", tool_calls=[])],
        }

    runner = make_analyst_runner(analyst_node, tool_node, report_key="market_report")
    out = runner({"messages": []})

    assert out["market_report"] == "done"
    assert tool_node.calls == 1


def test_analyst_runner_adds_structured_opinion_and_renders_report():
    opinion = AgentOpinion(
        agent_name="Market Analyst",
        role="market_analyst",
        stance=AgentStance.BULLISH,
        confidence=0.7,
        key_evidence=["price reclaimed support"],
        raw_text="raw report",
        source_report_type="market",
    )

    def analyst_node(_state):
        return {
            "market_report": "raw report",
            "messages": [FakeMessage(content="final", tool_calls=[])],
        }

    runner = make_analyst_runner(
        analyst_node,
        FakeToolNode(),
        report_key="market_report",
        opinion_key="market_opinion",
        opinion_builder=lambda _state, _report: opinion,
    )
    out = runner({"messages": [], "company_of_interest": "BTC/USDT"})

    assert AgentOpinion.model_validate(out["market_opinion"]) == opinion
    assert "**Stance**: bullish" in out["market_report"]
    assert "price reclaimed support" in out["market_report"]


def test_analyst_opinion_builder_uses_structured_output():
    structured = MagicMock()
    structured.invoke.return_value = AgentOpinion(
        agent_name="ignored",
        role="ignored",
        stance=AgentStance.BEARISH,
        confidence=0.6,
        key_evidence=["funding crowded"],
    )
    llm = MagicMock()
    llm.with_structured_output.return_value = structured
    builder = create_analyst_opinion_builder(
        llm=llm,
        agent_name="Sentiment Analyst",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    opinion = builder(
        {"company_of_interest": "BTC/USDT", "trade_date": "2026-05-08"},
        "Social sentiment deteriorated as funding crowded.",
    )

    llm.with_structured_output.assert_called_once_with(AgentOpinion)
    assert opinion.agent_name == "Sentiment Analyst"
    assert opinion.role == "sentiment_analyst"
    assert opinion.source_report_type == "sentiment"
    assert opinion.raw_text == "Social sentiment deteriorated as funding crowded."


def test_build_agent_opinions_prefers_structured_analyst_state():
    structured = AgentOpinion(
        agent_name="ignored",
        role="ignored",
        stance=AgentStance.BULLISH,
        confidence=0.72,
        key_evidence=["structured evidence"],
        raw_text="structured raw",
    )
    opinions = build_agent_opinions(
        {
            "market_report": "free text would parse differently",
            "market_opinion": structured.model_dump(mode="json"),
            "sentiment_report": "",
            "news_report": "",
            "fundamentals_report": "",
        },
        research_run_id="run_1",
        quant_signal_result=None,
    )

    assert len(opinions) == 1
    assert opinions[0].research_run_id == "run_1"
    assert opinions[0].agent_name == "Market Analyst"
    assert opinions[0].key_evidence == ["structured evidence"]


def test_opinion_from_text_extracts_bullets_and_pipe_separated_fields():
    opinion = opinion_from_text(
        "Market Analyst",
        "\n".join(
            [
                "- signal: Trend breakout confirmed because volume expanded.",
                "- risk: Funding is overheated and liquidation risk increased.",
                "| missing | on-chain data unavailable |",
            ]
        ),
        research_run_id="run_1",
        role="market_analyst",
        source_report_type="market",
    )

    assert opinion is not None
    assert opinion.key_evidence[0] == (
        "signal: Trend breakout confirmed because volume expanded."
    )
    assert opinion.risks == [
        "risk: Funding is overheated and liquidation risk increased."
    ]
    assert opinion.missing_data == ["missing: on-chain data unavailable"]


def test_default_analyst_definitions_match_default_selection_order():
    assert tuple(definition.selection_key for definition in ANALYST_DEFINITIONS) == (
        DEFAULT_ANALYSTS
    )
    assert len({definition.report_key for definition in ANALYST_DEFINITIONS}) == len(
        ANALYST_DEFINITIONS
    )
