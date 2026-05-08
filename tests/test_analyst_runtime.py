from dataclasses import dataclass

from tradingagents.graph.analyst_runtime import make_analyst_runner


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
                "messages": [FakeMessage(content="need tool", tool_calls=[{"name": "x"}])],
            }
        return {
            "market_report": "done",
            "messages": [FakeMessage(content="final", tool_calls=[])],
        }

    runner = make_analyst_runner(analyst_node, tool_node, report_key="market_report")
    out = runner({"messages": []})

    assert out["market_report"] == "done"
    assert tool_node.calls == 1
