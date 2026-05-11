# Import tools from separate utility files
import unicodedata
from tradingagents.agents.utils.technical_indicators_tools import get_indicators
from tradingagents.agents.utils.news_data_tools import get_news, get_global_news
from tradingagents.agents.utils.multi_timeframe_tools import (
    get_multi_timeframe_analysis,
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
    """
    if config is None:
        raise RuntimeError(
            "No config passed to get_language_instruction(). "
            "Thread config explicitly from the agent factory."
        )
    lang = config.get("output_language", "English")
    if lang.strip().lower() == "english":
        return ""
    return f" Write your entire response in {lang}."


def sanitize_ticker_for_prompt(value: object, *, max_len: int = 64) -> str:
    """Strip control/format characters before embedding a ticker in LLM prompts.

    Path safety is enforced separately via :func:`safe_ticker_component`; prompt
    context still needs deterministic printable text to reduce delimiter tricks.
    """
    if not isinstance(value, str):
        raise TypeError(
            f"ticker must be str for prompt sanitization, got {type(value)}"
        )
    # Remove control chars, keep printable Unicode (pairs like BTC/USDT remain).
    cleaned = "".join(
        ch
        for ch in value.strip()
        if ch.isprintable()
        and unicodedata.category(ch) not in {"Cf", "Cc", "Cs"}
        and ord(ch) != 127
    )
    cleaned = cleaned.replace("\ufeff", "")
    collapsed = " ".join(cleaned.replace("\t", " ").replace("\r", "\n").split())
    if len(collapsed) > max_len:
        collapsed = collapsed[:max_len].rstrip()
    return collapsed


def build_instrument_context(ticker: str) -> str:
    """Describe the exact instrument so agents use crypto trading pair format."""
    safe = sanitize_ticker_for_prompt(ticker)
    if not safe:
        safe = "UNKNOWN"
    suffix_guidance = (
        "preserving any exchange suffix or trading pair format exactly as provided "
        "(e.g. `7203.T`, `BTC/USDT`, `ETH/USDT`)"
    )

    return (
        f"The instrument to analyze is `{safe}`. "
        "Use this exact ticker in every tool call, report, and recommendation, "
        f"{suffix_guidance}."
    )


__all__ = [
    "get_indicators",
    "get_news",
    "get_global_news",
    "get_multi_timeframe_analysis",
    "get_fear_greed_index",
    "get_social_sentiment",
    "get_news_sentiment_aggregate",
    "get_language_instruction",
    "sanitize_ticker_for_prompt",
    "build_instrument_context",
]
