from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    get_language_instruction,
    get_news,
    get_fear_greed_index,
    get_social_sentiment,
    get_news_sentiment_aggregate,
)
def create_social_media_analyst(llm, config=None):
    def social_media_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = build_instrument_context(state["company_of_interest"])

        tools = [
            get_news,
            get_fear_greed_index,
            get_social_sentiment,
            get_news_sentiment_aggregate,
        ]

        entity = "project"  # crypto

        system_message = (
            f"You are a social media and {entity}-specific news researcher/analyst tasked with analyzing social media posts, recent {entity} news, and public sentiment for a specific {entity} over the past week. You will be given a {entity}'s name; your objective is to write a comprehensive long report detailing your analysis, insights, and implications for traders and investors on this {entity}'s current state after looking at social media and what people are saying about that {entity}, analyzing sentiment data of what people feel each day about the {entity}, and looking at recent {entity} news. Use the tools at your disposal: `get_news` for {entity}-specific news and discussions, `get_fear_greed_index` for market-wide sentiment gauge, `get_social_sentiment` for social media trending/engagement data, and `get_news_sentiment_aggregate` for aggregated bullish/bearish scoring of recent headlines. Provide specific, actionable insights with supporting evidence to help traders make informed decisions."
            + """ Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."""
            + get_language_instruction(config=config)
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " If you are unable to fully answer, that's OK; another assistant with different tools"
                    " will help where you left off. Execute what you can to make progress."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    " You have access to the following tools: {tool_names}.\n{system_message}"
                    "For your reference, the current date is {current_date}. {instrument_context}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(tool_names=", ".join([tool.name for tool in tools]))
        prompt = prompt.partial(current_date=current_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        chain = prompt | llm.bind_tools(tools)

        messages = state.get("messages", [])
        result = chain.invoke(messages)

        report = ""

        if len(result.tool_calls) == 0:
            report = result.content

        return {
            "sentiment_report": report,
            "messages": [result],
        }

    return social_media_analyst_node
