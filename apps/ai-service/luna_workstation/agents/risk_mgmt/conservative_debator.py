from luna_workstation.agents.utils.agent_utils import (
    DEBATE_ARGUMENT_CONTEXT_CHARS,
    DEBATE_HISTORY_CONTEXT_CHARS,
    DEBATE_REPORT_CONTEXT_CHARS,
    DEBATE_RESPONSE_INSTRUCTION,
    DEBATE_SETUP_CONTEXT_CHARS,
    guard_untrusted_context,
)


def create_conservative_debator(llm):
    def conservative_node(state) -> dict:
        risk_debate_state = state["risk_debate_state"]
        history = risk_debate_state.get("history", "")
        conservative_history = risk_debate_state.get("conservative_history", "")

        current_aggressive_response = risk_debate_state.get(
            "current_aggressive_response", ""
        )
        current_neutral_response = risk_debate_state.get("current_neutral_response", "")

        market_research_report = state["market_report"]
        sentiment_report = state["sentiment_report"]
        news_report = state["news_report"]
        fundamentals_report = state["fundamentals_report"]

        setup_proposal = state["trader_investment_plan"]

        prompt = f"""As the Conservative Risk Analyst, your primary objective is to protect assets, minimize volatility, and ensure steady, reliable growth. You prioritize stability, security, and risk mitigation, carefully assessing potential losses, economic downturns, and market volatility. When evaluating the Setup Planner's proposal, critically examine high-risk elements, pointing out where the setup may expose the user to undue risk and where more cautious alternatives could protect capital. Here is the setup proposal:

{guard_untrusted_context("setup_proposal", setup_proposal, max_chars=DEBATE_SETUP_CONTEXT_CHARS)}

Your task is to actively counter the arguments of the Aggressive and Neutral Analysts, highlighting where their views may overlook potential threats or fail to prioritize sustainability. Respond directly to their points, drawing from the following data sources to build a convincing case for a lower-risk adjustment to the setup proposal:

Market Research Report: {guard_untrusted_context("market_report", market_research_report, max_chars=DEBATE_REPORT_CONTEXT_CHARS)}
Social Media Sentiment Report: {guard_untrusted_context("sentiment_report", sentiment_report, max_chars=DEBATE_REPORT_CONTEXT_CHARS)}
Latest World Affairs Report: {guard_untrusted_context("news_report", news_report, max_chars=DEBATE_REPORT_CONTEXT_CHARS)}
Company Fundamentals Report: {guard_untrusted_context("fundamentals_report", fundamentals_report, max_chars=DEBATE_REPORT_CONTEXT_CHARS)}
Here is the current conversation history: {guard_untrusted_context("risk_history", history, max_chars=DEBATE_HISTORY_CONTEXT_CHARS)} Here is the last response from the aggressive analyst: {guard_untrusted_context("last_aggressive_argument", current_aggressive_response, max_chars=DEBATE_ARGUMENT_CONTEXT_CHARS)} Here is the last response from the neutral analyst: {guard_untrusted_context("last_neutral_argument", current_neutral_response, max_chars=DEBATE_ARGUMENT_CONTEXT_CHARS)}. If there are no responses from the other viewpoints yet, present your own argument based on the available data.

Engage by questioning their optimism and emphasizing the potential downsides they may have overlooked. Address each of their counterpoints to showcase why a conservative stance is ultimately the safest path for the firm's assets. Focus on debating and critiquing their arguments to demonstrate the strength of a low-risk strategy over their approaches. Output conversationally as if you are speaking without any special formatting.
{DEBATE_RESPONSE_INSTRUCTION}"""

        response = llm.invoke(prompt)

        argument = f"Conservative Analyst: {response.content}"

        new_risk_debate_state = {
            "history": history + "\n" + argument,
            "aggressive_history": risk_debate_state.get("aggressive_history", ""),
            "conservative_history": conservative_history + "\n" + argument,
            "neutral_history": risk_debate_state.get("neutral_history", ""),
            "latest_speaker": "Conservative",
            "current_aggressive_response": risk_debate_state.get(
                "current_aggressive_response", ""
            ),
            "current_conservative_response": argument,
            "current_neutral_response": risk_debate_state.get(
                "current_neutral_response", ""
            ),
            "count": risk_debate_state["count"] + 1,
        }

        return {"risk_debate_state": new_risk_debate_state}

    return conservative_node
