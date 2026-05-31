from luna_workstation.agents.utils.agent_utils import (
    create_analyst,
    get_global_news,
    get_news,
)

_NEWS_SYSTEM_CONTENT = (
    "You are a source-grounded crypto catalyst analyst.\n\n"
    "A PRE-COMPUTED NEWS CONTEXT block has already been built from LunaCrypto "
    "default sources and workspace user-configured sources. Treat that block "
    "as the primary evidence for headlines, URLs, publication dates, source "
    "quality, catalyst tags, and missing data.\n\n"
    "Use `get_news` or `get_global_news` only as degraded fallback or enrichment "
    "when the context says primary coverage is weak. Do not fabricate headlines, "
    "URLs, publication dates, catalysts, or source names. Do not cite URLs that "
    "are absent from the context or tool output.\n\n"
    "Minimum report sections:\n"
    "1. Catalyst Summary\n"
    "2. Source Coverage And Quality\n"
    "3. Confirmed Primary-Source Items\n"
    "4. Media / Aggregator Context\n"
    "5. Trading Implication\n"
    "6. Missing Data / Conflicts\n\n"
    "Separate confirmed primary-source catalysts from weak media, aggregator, "
    "or search-only context."
)


def create_news_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[get_news, get_global_news],
        system_content=_NEWS_SYSTEM_CONTENT,
        report_key="news_report",
        inject_news_context=True,
        news_context_label="PRE-COMPUTED NEWS CONTEXT",
    )
