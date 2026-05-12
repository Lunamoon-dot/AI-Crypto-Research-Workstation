"""Runtime helpers for analyst execution with local tool loops."""

from __future__ import annotations

from typing import Any, Callable

from tradingagents.domain import AgentOpinion, render_agent_opinion


def make_analyst_runner(
    analyst_node: Callable[[dict], dict],
    tool_node: Any,
    *,
    report_key: str,
    opinion_key: str | None = None,
    opinion_builder: Callable[[dict, str], Any] | None = None,
    max_tool_rounds: int = 6,
) -> Callable[[dict], dict]:
    """Wrap an analyst node so it completes its own tool loop in one graph step."""

    def _run(state: dict) -> dict:
        local_state = {**state}
        local_messages = list(local_state.get("messages", []))
        report = ""
        last_ai_message = None

        for _ in range(max_tool_rounds):
            local_state["messages"] = local_messages
            analyst_out = analyst_node(local_state) or {}
            emitted = list(analyst_out.get("messages", []))
            if not emitted:
                break

            ai_message = emitted[-1]
            last_ai_message = ai_message
            local_messages.append(ai_message)

            tool_calls = getattr(ai_message, "tool_calls", None) or []
            if not tool_calls:
                report = analyst_out.get(report_key, "") or report
                break

            tool_out = tool_node.invoke({"messages": [ai_message]}) or {}
            local_messages.extend(list(tool_out.get("messages", [])))

        result: dict[str, Any] = {report_key: report}
        if opinion_key and opinion_builder and report:
            opinion = opinion_builder(local_state, report)
            if opinion is not None:
                typed_opinion = (
                    opinion
                    if isinstance(opinion, AgentOpinion)
                    else AgentOpinion.model_validate(opinion)
                )
                result[opinion_key] = typed_opinion.model_dump(mode="json")
                result[report_key] = render_agent_opinion(typed_opinion)
        if last_ai_message is not None:
            result["messages"] = [last_ai_message]
        return result

    return _run
