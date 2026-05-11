from tradingagents.agents.utils.agent_utils import guard_untrusted_context


def create_bull_researcher(llm, config=None):
    def bull_node(state) -> dict:
        instrument = "cryptocurrency"
        entity = "project"

        investment_debate_state = state["investment_debate_state"]
        history = investment_debate_state.get("history", "")
        bull_history = investment_debate_state.get("bull_history", "")

        current_response = investment_debate_state.get("current_response", "")
        market_research_report = state["market_report"]
        sentiment_report = state["sentiment_report"]
        news_report = state["news_report"]
        fundamentals_report = state["fundamentals_report"]

        prompt = f"""You are a Bull Analyst advocating for investing in the {instrument}. Your task is to build a strong, evidence-based case emphasizing growth potential, competitive advantages, and positive market indicators. Leverage the provided research and data to address concerns and counter bearish arguments effectively.

Key points to focus on:
- Growth Potential: Highlight the {entity}'s market opportunities, revenue or adoption projections, and scalability.
- Competitive Advantages: Emphasize factors like unique technology, strong community, or dominant market positioning.
- Positive Indicators: The Market Research Report contains a pre-computed quantitative signal (Strong Buy/Buy/Neutral/Sell/Strong Sell with factor breakdowns). Use this as your primary quantitative baseline. Supplement with fundamental health, market trends, and recent positive news.
- Bear Counterpoints: Critically analyze the bear argument with specific data and sound reasoning, addressing concerns thoroughly and showing why the bull perspective holds stronger merit.
- Engagement: Present your argument in a conversational style, engaging directly with the bear analyst's points and debating effectively rather than just listing data.

Resources available:
Market research report (includes quant signal): {guard_untrusted_context("market_report", market_research_report)}
Social media sentiment report: {guard_untrusted_context("sentiment_report", sentiment_report)}
Latest world affairs news: {guard_untrusted_context("news_report", news_report)}
Fundamentals report: {guard_untrusted_context("fundamentals_report", fundamentals_report)}
Conversation history of the debate: {guard_untrusted_context("debate_history", history)}
Last bear argument: {guard_untrusted_context("last_bear_argument", current_response)}
Use this information to deliver a compelling bull argument, refute the bear's concerns, and engage in a dynamic debate that demonstrates the strengths of the bull position.
"""

        response = llm.invoke(prompt)

        argument = f"Bull Analyst: {response.content}"

        new_investment_debate_state = {
            "history": history + "\n" + argument,
            "bull_history": bull_history + "\n" + argument,
            "bear_history": investment_debate_state.get("bear_history", ""),
            "current_response": argument,
            "count": investment_debate_state["count"] + 1,
        }

        return {"investment_debate_state": new_investment_debate_state}

    return bull_node
