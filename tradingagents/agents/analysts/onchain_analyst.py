"""On-chain analyst: replaces the Fundamentals analyst for crypto.

Covers exchange market data (ticker snapshot, funding rates, open interest)
instead of balance sheets and income statements.
"""

from __future__ import annotations

from tradingagents.agents.utils.agent_utils import create_analyst
from tradingagents.agents.utils.crypto_tools import (
    get_crypto_ticker,
    get_crypto_long_short_ratio,
    get_crypto_nvt,
    get_crypto_supply,
    get_crypto_exchange_metrics,
)

_ONCHAIN_SYSTEM_CONTENT = (
    "You are a researcher tasked with analyzing on-chain and market data for a cryptocurrency over the past week. "
    "Write a comprehensive report covering: current market snapshot (price, 24h volume, bid/ask spread), "
    "long/short ratio (extreme ratios signal crowded trades), NVT approximation (market cap / daily volume — "
    "high values suggest speculation), token supply metrics (circulating/total/max supply, FDV/MC ratio), "
    "exchange reserves and turnover (liquidity depth). Provide specific, actionable insights with supporting evidence.\n\n"
    "IMPORTANT: A quantitative signal engine has already computed funding rates, open interest trends, "
    "and liquidation data. The pre-computed signal is provided below. Do NOT re-fetch funding/OI/liquidation data. "
    "Instead, reference the pre-computed signal for those metrics and use your tools for ONCHAIN-SPECIFIC data "
    "(ticker snapshot, long/short ratio, NVT, supply, exchange metrics)."
    + " Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."
    + " Use the available tools: `get_crypto_ticker` for 24h market snapshot, "
    "`get_crypto_long_short_ratio` for position skew, `get_crypto_nvt` for valuation ratio, "
    "`get_crypto_supply` for tokenomics, and `get_crypto_exchange_metrics` for liquidity/reserve data."
)


def create_onchain_analyst(llm, config=None):
    return create_analyst(
        llm=llm,
        config=config,
        tools=[
            get_crypto_ticker,
            get_crypto_long_short_ratio,
            get_crypto_nvt,
            get_crypto_supply,
            get_crypto_exchange_metrics,
        ],
        system_content=_ONCHAIN_SYSTEM_CONTENT,
        report_key="fundamentals_report",
        inject_quant_signal=True,
        quant_signal_label="PRE-COMPUTED QUANT SIGNAL (contains funding, OI, liquidation data)",
    )