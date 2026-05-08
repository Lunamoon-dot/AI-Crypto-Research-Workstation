# Import tools from separate utility files
from tradingagents.agents.utils.technical_indicators_tools import (
    get_indicators
)
from tradingagents.agents.utils.news_data_tools import (
    get_news,
    get_global_news
)
from tradingagents.agents.utils.multi_timeframe_tools import (
    get_multi_timeframe_analysis
)
from tradingagents.agents.utils.sentiment_tools import (
    get_fear_greed_index,
    get_social_sentiment,
    get_news_sentiment_aggregate,
)


def get_language_instruction(config=None) -> str:
    """Return a prompt instruction for the configured output language.

    Returns empty string when English (default), so no extra tokens are used.
    Only applied to user-facing agents (analysts, portfolio manager).
    Internal debate agents stay in English for reasoning quality.

    Accepts an optional *config* dict.  When ``None``, falls back to the
    module-level global (backward compat).
    """
    if config is not None:
        lang = config.get("output_language", "English")
    else:
        from tradingagents.dataflows.config import get_config
        lang = get_config().get("output_language", "English")
    if lang.strip().lower() == "english":
        return ""
    return f" Write your entire response in {lang}."


def build_instrument_context(ticker: str) -> str:
    """Describe the exact instrument so agents use crypto trading pair format."""
    suffix_guidance = (
        "preserving any exchange suffix or trading pair format exactly as provided "
        "(e.g. `7203.T`, `BTC/USDT`, `ETH/USDT`)"
    )

    return (
        f"The instrument to analyze is `{ticker}`. "
        "Use this exact ticker in every tool call, report, and recommendation, "
        f"{suffix_guidance}."
    )


