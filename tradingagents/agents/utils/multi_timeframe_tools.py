"""LangChain tool wrapper for multi-timeframe analysis.

Exposes a single ``get_multi_timeframe_analysis`` tool that analysts can
call after fetching OHLCV data.  It re-reads the raw CSV from the vendor
layer so it works regardless of which data vendor is configured.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.interface import route_to_vendor
from tradingagents.dataflows.timeframe_analyzer import generate_mtf_report


@tool
def get_multi_timeframe_analysis(
    symbol: Annotated[str, "Ticker or trading pair symbol, e.g. AAPL, BTC/USDT"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
) -> str:
    """Analyze trend alignment across daily, weekly, and monthly timeframes.

    Fetches OHLCV data then resamples to weekly/monthly bars.  Returns a
    structured report showing each timeframe's trend direction, strength,
    and an alignment score (0-100) that indicates how well the timeframes
    agree.  Higher scores suggest higher-conviction trades.
    """
    from tradingagents.dataflows.config import get_config

    cfg = get_config()
    method = "get_crypto_ohlcv"

    csv_data = route_to_vendor(method, symbol, start_date, end_date)
    return generate_mtf_report(csv_data, start_date, end_date, symbol)
