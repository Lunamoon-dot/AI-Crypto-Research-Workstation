from luna_workstation.agents.utils.agent_utils import (
    create_analyst,
    get_global_news,
    get_news,
)

_NEWS_SYSTEM_CONTENT = (
    "You are a news researcher tasked with analyzing recent news and trends over the past week. Please write a comprehensive report of the current state of the world that is relevant for trading and macroeconomics. Use the available tools: get_news(query, start_date, end_date) for company-specific or targeted news searches, and get_global_news(curr_date, look_back_days, limit) for broader macroeconomic news. Provide specific, actionable insights with supporting evidence to help traders make informed decisions."
    + """ Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."""
)


def create_news_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[get_news, get_global_news],
        system_content=_NEWS_SYSTEM_CONTENT,
        report_key="news_report",
    )
