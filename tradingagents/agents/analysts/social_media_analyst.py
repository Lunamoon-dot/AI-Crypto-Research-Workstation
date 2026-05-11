from tradingagents.agents.utils.agent_utils import (
    create_analyst,
    get_fear_greed_index,
    get_news,
    get_news_sentiment_aggregate,
    get_social_sentiment,
)

_SOCIAL_SYSTEM_CONTENT = (
    "You are a social media and project-specific news researcher/analyst tasked with analyzing social media posts, recent project news, and public sentiment for a specific project over the past week. You will be given a project's name; your objective is to write a comprehensive long report detailing your analysis, insights, and implications for traders and investors on this project's current state after looking at social media and what people are saying about that project, analyzing sentiment data of what people feel each day about the project, and looking at recent project news. Use the tools at your disposal: `get_news` for project-specific news and discussions, `get_fear_greed_index` for market-wide sentiment gauge, `get_social_sentiment` for social media trending/engagement data, and `get_news_sentiment_aggregate` for aggregated bullish/bearish scoring of recent headlines. Provide specific, actionable insights with supporting evidence to help traders make informed decisions."
    + """ Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."""
)


def create_social_media_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[
            get_news,
            get_fear_greed_index,
            get_social_sentiment,
            get_news_sentiment_aggregate,
        ],
        system_content=_SOCIAL_SYSTEM_CONTENT,
        report_key="sentiment_report",
    )
