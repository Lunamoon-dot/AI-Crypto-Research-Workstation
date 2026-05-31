from types import SimpleNamespace

import pytest

from luna_workstation.graph import run_orchestrator
from luna_workstation.graph.run_orchestrator import ResearchRunOrchestrator


class _Graph:
    def __init__(self, final_state):
        self.final_state = final_state

    def invoke(self, _state, **_kwargs):
        return dict(self.final_state)


def _host(final_state, timeline):
    return SimpleNamespace(
        config={
            "asset_class": "crypto",
            "checkpoint_enabled": False,
            "data_vendors": {},
            "market_type": "spot",
        },
        debug=False,
        graph=_Graph(final_state),
        propagator=SimpleNamespace(
            create_initial_state=lambda *_args, **_kwargs: {},
            get_graph_args=lambda **_kwargs: {},
        ),
        _start_journal_run=lambda: None,
        _precompute_quant_signal=lambda *_args: "",
        _save_journal_quant_signals=lambda: None,
        _save_journal_agent_research=lambda _state: None,
        _complete_journal_run=lambda: timeline.append("complete_journal"),
        _log_state=lambda *_args: timeline.append("log_state"),
        _build_trade_thesis=lambda _state: (
            timeline.append("build_thesis") or SimpleNamespace(id="thesis_1")
        ),
        process_signal=lambda _text: "Overweight",
        current_research_run=None,
        current_trade_thesis=None,
        current_signals=[],
        current_agent_opinions=[],
        current_debate=None,
    )


def _final_state():
    return {
        "final_trade_decision": "**Rating**: Overweight\n\nConstructive.",
        "final_trade_summary_json": '{"rating": "Overweight"}',
    }


def test_completed_event_is_logged_after_thesis_and_journal_completion(monkeypatch):
    timeline = []

    def fake_log_event(_logger, event, **_kwargs):
        timeline.append(event)

    monkeypatch.setattr(run_orchestrator, "log_event", fake_log_event)

    ResearchRunOrchestrator().run_graph(
        _host(_final_state(), timeline),
        "BTC/USDT",
        "2026-05-16",
    )

    assert timeline.index("agent_node_started") < timeline.index("build_thesis")
    assert timeline.index("build_thesis") < timeline.index("complete_journal")
    assert timeline.index("thesis_generated") < timeline.index("complete_journal")
    assert timeline.index("agent_node_completed") < timeline.index("complete_journal")
    assert timeline.index("complete_journal") < timeline.index("research_run_completed")


def test_completed_event_is_not_logged_when_thesis_build_fails(monkeypatch):
    timeline = []
    host = _host(_final_state(), timeline)

    def fake_log_event(_logger, event, **_kwargs):
        timeline.append(event)

    def fail_build(_state):
        timeline.append("build_thesis")
        raise ValueError("thesis validator failed")

    monkeypatch.setattr(run_orchestrator, "log_event", fake_log_event)
    host._build_trade_thesis = fail_build

    with pytest.raises(ValueError, match="thesis validator failed"):
        ResearchRunOrchestrator().run_graph(host, "BTC/USDT", "2026-05-16")

    assert "build_thesis" in timeline
    assert "agent_node_failed" in timeline
    assert "thesis_generated" not in timeline
    assert "agent_node_completed" not in timeline
    assert "research_run_completed" not in timeline


def test_run_orchestrator_adds_market_context_to_initial_state(monkeypatch):
    captured = {}

    class Host:
        config = {
            "asset_class": "crypto",
            "market_type": "spot",
            "llm_provider": "test",
            "checkpoint_enabled": False,
            "data_vendors": {},
        }
        graph = None
        debug = False
        callbacks = []
        propagator = None
        current_research_run = None
        current_trade_thesis = None
        current_signals = []
        current_agent_opinions = []
        current_debate = None
        curr_state = None
        journal_bridge = None

        def _start_journal_run(self):
            pass

        def _precompute_quant_signal(self, symbol, trade_date):
            return "QUANT"

        def _precompute_market_context(self, symbol, trade_date):
            return "MARKET"

        def _save_journal_quant_signals(self):
            pass

        def _save_journal_agent_research(self, final_state):
            pass

        def _complete_journal_run(self):
            pass

        def _log_state(self, trade_date, final_state):
            pass

        def _build_trade_thesis(self, final_state):
            return SimpleNamespace(id="thesis_1")

        def process_signal(self, text):
            return "Overweight"

    class Propagator:
        def create_initial_state(self, company_name, trade_date, past_context, market_type):
            return {
                "company_of_interest": company_name,
                "trade_date": trade_date,
                "past_context": past_context,
                "market_type": market_type,
                "messages": [],
            }

        def get_graph_args(self, callbacks=None):
            return {}

    class Graph:
        def invoke(self, init_state, **_args):
            captured.update(init_state)
            return {
                **init_state,
                "market_report": "ok",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "investment_debate_state": {},
                "risk_debate_state": {},
                "final_trade_decision": "**Rating**: Overweight\n\nConstructive.",
                "final_trade_summary_json": '{"rating": "Overweight"}',
            }

    host = Host()
    host.graph = Graph()
    host.propagator = Propagator()

    monkeypatch.setattr(
        "luna_workstation.graph.run_orchestrator.compute_config_hash",
        lambda _config: "hash",
    )

    ResearchRunOrchestrator().run_graph(host, "BTC/USDT", "2026-05-31")

    assert captured["quant_signal"] == "QUANT"
    assert captured["market_context"] == "MARKET"


def test_run_orchestrator_adds_news_context_and_quality_to_initial_state(monkeypatch):
    captured = {}

    class FakeNewsContext:
        quality = SimpleNamespace(
            status="degraded",
            reason_codes=["aggregator_only_news", "low_relevance_news"],
        )

        def model_dump(self, mode="python"):
            assert mode == "json"
            return {
                "quality": {
                    "status": "degraded",
                    "reason_codes": ["aggregator_only_news", "low_relevance_news"],
                }
            }

    class Host:
        config = {
            "asset_class": "crypto",
            "market_type": "spot",
            "llm_provider": "test",
            "checkpoint_enabled": False,
            "data_vendors": {},
        }
        graph = None
        debug = False
        callbacks = []
        propagator = None
        current_research_run = None
        current_trade_thesis = None
        current_signals = []
        current_agent_opinions = []
        current_debate = None
        curr_state = None
        journal_bridge = None
        news_context_result = FakeNewsContext()

        def _start_journal_run(self):
            pass

        def _precompute_quant_signal(self, symbol, trade_date):
            return "QUANT"

        def _precompute_market_context(self, symbol, trade_date):
            return ""

        def _precompute_news_context(self, symbol, trade_date):
            return "NEWS"

        def _save_journal_quant_signals(self):
            pass

        def _save_journal_agent_research(self, final_state):
            pass

        def _complete_journal_run(self):
            pass

        def _log_state(self, trade_date, final_state):
            pass

        def _build_trade_thesis(self, final_state):
            return SimpleNamespace(id="thesis_1")

        def process_signal(self, text):
            return "Overweight"

    class Propagator:
        def create_initial_state(self, company_name, trade_date, past_context, market_type):
            return {
                "company_of_interest": company_name,
                "trade_date": trade_date,
                "past_context": past_context,
                "market_type": market_type,
                "messages": [],
            }

        def get_graph_args(self, callbacks=None):
            return {}

    class Graph:
        def invoke(self, init_state, **_args):
            captured.update(init_state)
            return {
                **init_state,
                "market_report": "",
                "sentiment_report": "",
                "news_report": "",
                "fundamentals_report": "",
                "investment_debate_state": {},
                "risk_debate_state": {},
                "final_trade_decision": "**Rating**: Overweight\n\nConstructive.",
                "final_trade_summary_json": '{"rating": "Overweight"}',
            }

    host = Host()
    host.graph = Graph()
    host.propagator = Propagator()

    monkeypatch.setattr(
        "luna_workstation.graph.run_orchestrator.compute_config_hash",
        lambda _config: "hash",
    )

    ResearchRunOrchestrator().run_graph(host, "ARB/USDT", "2026-05-31")

    assert captured["news_context"] == "NEWS"
    assert captured["news_context_snapshot"]["quality"]["status"] == "degraded"
    assert "aggregator_only_news" in host.current_research_run.missing_optional_data
    assert "low_relevance_news" in host.current_research_run.degradation_reasons
