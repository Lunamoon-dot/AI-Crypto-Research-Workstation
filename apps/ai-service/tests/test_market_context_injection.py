from unittest.mock import MagicMock

from luna_workstation.agents.analysts.market_analyst import create_market_analyst


class FakeBoundLLM:
    def invoke(self, _messages):
        return MagicMock(content="market report")


class FakeLLM:
    def __init__(self):
        self.prompt = None

    def bind_tools(self, _tools):
        return FakeBoundLLM()


def test_market_analyst_injects_market_context(monkeypatch):
    captured = {}

    class FakePrompt:
        def __init__(self):
            self.partials = {}

        @classmethod
        def from_messages(cls, _messages):
            return cls()

        def partial(self, **kwargs):
            self.partials.update(kwargs)
            captured.update(kwargs)
            return self

        def __or__(self, _other):
            return FakeBoundLLM()

    monkeypatch.setattr(
        "luna_workstation.agents.utils.agent_utils.ChatPromptTemplate",
        FakePrompt,
    )

    analyst = create_market_analyst(FakeLLM(), config={"output_language": "English"})
    result = analyst(
        {
            "company_of_interest": "BTC/USDT",
            "trade_date": "2026-05-31",
            "messages": [],
            "quant_signal": "QUANT BLOCK",
            "market_context": "MARKET CONTEXT BLOCK",
        }
    )

    assert result["market_report"] == "market report"
    assert "MARKET CONTEXT BLOCK" in captured["system_message"]
    assert "QUANT BLOCK" in captured["system_message"]
