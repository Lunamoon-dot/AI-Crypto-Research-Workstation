from unittest.mock import MagicMock

from luna_workstation.agents.analysts.news_analyst import create_news_analyst


class FakeBoundLLM:
    def invoke(self, _messages):
        return MagicMock(content="news report")


class FakeLLM:
    def bind_tools(self, _tools):
        return FakeBoundLLM()


def test_news_analyst_injects_precomputed_news_context(monkeypatch):
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

    analyst = create_news_analyst(FakeLLM(), config={"output_language": "English"})
    result = analyst(
        {
            "company_of_interest": "ARB/USDT",
            "trade_date": "2026-05-31",
            "messages": [],
            "news_context": "NEWS CONTEXT BLOCK",
        }
    )

    assert result["news_report"] == "news report"
    assert "NEWS CONTEXT BLOCK" in captured["system_message"]
    assert "PRE-COMPUTED NEWS CONTEXT" in captured["system_message"]
    assert "Do not fabricate headlines" in captured["system_message"]
