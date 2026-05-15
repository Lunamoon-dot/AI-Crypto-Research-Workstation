from tradingagents.agents.utils.agent_utils import (
    create_analyst,
    get_fear_greed_index,
    get_news,
    get_news_sentiment_aggregate,
    get_social_sentiment,
)

_SOCIAL_SYSTEM_CONTENT = (
    "You are a social media and project-specific news researcher/analyst tasked "
    "with analyzing social media posts, recent project news, and public "
    "sentiment for a specific crypto asset over the past week. Use `get_news` "
    "for project-specific news and discussions, `get_social_sentiment` for "
    "social interest, `get_news_sentiment_aggregate` for a headline sentiment "
    "heuristic, and `get_fear_greed_index` only for broad crypto macro mood. "
    "Important evidence rules: Fear & Greed is market-wide and must never be "
    "framed as coin-specific sentiment; low headline counts from the news "
    "sentiment aggregate are weak warnings/context only, not strong directional "
    "evidence. Provide specific insights only when supported by asset-specific "
    "sources, and explicitly label weak or missing evidence."
    " Make sure to append a Markdown table at the end of the report to organize "
    "key points in the report, organized and easy to read."
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
