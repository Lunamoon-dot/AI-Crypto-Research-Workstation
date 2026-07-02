"""Crypto market-structure analyst.

Covers exchange market data and on-chain-adjacent proxies instead of balance
sheets and income statements.
"""

from __future__ import annotations

from luna_workstation.agents.utils.agent_utils import create_analyst
from luna_workstation.agents.utils.crypto_tools import (
    get_crypto_ticker,
    get_crypto_long_short_ratio,
    get_crypto_nvt,
    get_crypto_supply,
    get_crypto_exchange_metrics,
)

_ONCHAIN_SYSTEM_CONTENT = (
    "You are a crypto market-structure researcher analyzing exchange market "
    "data, token supply, and on-chain-adjacent proxies for the past week. "
    "The available tools are mostly CCXT/CoinGecko proxies: ticker snapshot, "
    "long/short ratio, market-cap-over-volume proxy, supply, turnover, and "
    "liquidity. They do not provide exchange inflow/outflow, wallet/whale "
    "movement, active addresses, realized network transaction volume, or TVL "
    "unless a tool output explicitly says so.\n\n"
    "Evidence rules: do not treat these proxy metrics as wallet-level evidence; do not "
    "claim institutional entry from tight spreads or liquidity; do not infer "
    "accumulation from low turnover because it can also mean weak participation. "
    "Do not cite whale accumulation, exchange inflow/outflow, active addresses, "
    "or wallet flows unless a tool output explicitly provides those metrics. "
    "Crowded long positioning is long-liquidation risk; short squeeze requires "
    "crowded short positioning or short liquidations. "
    "Describe NVT output as a valuation/liquidity proxy based on market cap / "
    "exchange volume, not true network transaction NVT. Burn mechanics reduce "
    "supply; never describe burns as minting. Zero dilution or burn "
    "mechanics can be structural context, but not a standalone entry signal.\n\n"
    "IMPORTANT: A quantitative signal engine has already computed funding "
    "rates, open interest trends, and liquidation data. The pre-computed signal "
    "is provided below. Do NOT re-fetch funding/OI/liquidation data. Reference "
    "that pre-computed signal for those metrics and use your tools for market "
    "snapshot, position skew, valuation/liquidity proxy, supply, and exchange "
    "volume/liquidity proxy data."
    " Make sure to append a Markdown table at the end of the report to organize "
    "key points in the report, organized and easy to read. The table must be a "
    "valid Markdown pipe table in its own block: one header row, one separator "
    "row like `|---|---|`, then one data row per line."
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
