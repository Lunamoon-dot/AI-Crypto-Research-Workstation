from luna_workstation.agents.utils.agent_utils import (
    create_analyst,
    get_fear_greed_index,
    get_social_sentiment,
)

_SOCIAL_SYSTEM_CONTENT = (
    "You are a social media sentiment researcher/analyst tasked "
    "with analyzing social media interest, trending context, and public "
    "sentiment for a specific crypto asset over the past week. Do not fetch or "
    "infer project-news coverage; that belongs to the News Analyst and its "
    "pre-computed news context. Use `get_social_sentiment` for social interest "
    "and `get_fear_greed_index` only for broad crypto macro mood. "
    "Important evidence rules: Fear & Greed is market-wide and must never be "
    "framed as coin-specific sentiment. Provide specific insights only when "
    "supported by asset-specific social/trending sources, and explicitly label "
    "weak or missing social evidence as `missing_social_feed`, not "
    "`missing_news_feed`."
    " Make sure to append a Markdown table at the end of the report to organize "
    "key points in the report, organized and easy to read."
)


def create_social_media_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[
            get_fear_greed_index,
            get_social_sentiment,
        ],
        system_content=_SOCIAL_SYSTEM_CONTENT,
        report_key="sentiment_report",
    )
