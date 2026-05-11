from tradingagents.agents.utils.agent_utils import (
    create_analyst,
    get_indicators,
    get_multi_timeframe_analysis,
)
from tradingagents.agents.utils.crypto_tools import get_crypto_ohlcv

_MARKET_SYSTEM_CONTENT = (
    "You are a Market Analyst in a multi-agent trading firm.\n\n"
    "A quantitative signal engine has ALREADY run and produced the "
    "structured assessment shown below. Do NOT call any signal-generation "
    "tools — that work is already done.\n\n"
    "YOUR JOB:\n"
    "1. Review the pre-computed quantitative signal (factor breakdown, "
    "   confidence, trend, regime).\n"
    "2. Interpret it — does the signal make sense? Are there conflicting "
    "   factors (e.g. RSI bullish but MACD bearish)? Is the confidence high?\n"
    "3. Optionally call `get_crypto_ohlcv`, `get_indicators`, or "
    "   `get_multi_timeframe_analysis` only to VERIFY a specific factor or "
    "   investigate a conflict.\n"
    "4. Write a concise report covering: the quant signal and your confidence "
    "   in it, which factors drive the signal, any conflicting indicators, "
    "   and actionable insights for the Trader.\n\n"
    "Your role is INTERPRETATION, not computation."
    + " Append a brief Markdown table organizing the signal factors at the end."
)


def create_market_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[get_crypto_ohlcv, get_indicators, get_multi_timeframe_analysis],
        system_content=_MARKET_SYSTEM_CONTENT,
        report_key="market_report",
        inject_quant_signal=True,
    )