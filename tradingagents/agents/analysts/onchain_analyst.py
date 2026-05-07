"""On-chain analyst: replaces the Fundamentals analyst for crypto.

Covers exchange market data (ticker snapshot, funding rates, open interest)
instead of balance sheets and income statements.
"""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    get_language_instruction,
)
from tradingagents.agents.utils.crypto_tools import (
    get_crypto_ticker,
    get_crypto_long_short_ratio,
    get_crypto_nvt,
    get_crypto_supply,
    get_crypto_exchange_metrics,
)
from tradingagents.dataflows.config import get_config


def create_onchain_analyst(llm):
    def onchain_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = build_instrument_context(state["company_of_interest"])

        tools = [
            get_crypto_ticker,
            get_crypto_long_short_ratio,
            get_crypto_nvt,
            get_crypto_supply,
            get_crypto_exchange_metrics,
        ]

        system_message = (
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
            + get_language_instruction()
        )

        # Inject pre-computed quant signal (contains funding/OI/liquidation data)
        quant_block = state.get("quant_signal", "")
        if quant_block:
            system_message += (
                f"\n\n===== PRE-COMPUTED QUANT SIGNAL =====\n"
                f"{quant_block}\n"
                f"===== END (contains funding, OI, liquidation data) ====="
            )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " If you are unable to fully answer, that's OK; another assistant with different tools"
                    " will help where you left off. Execute what you can to make progress."
                    " If you or any other assistant has the FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** or deliverable,"
                    " prefix your response with FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL** so the team knows to stop."
                    " You have access to the following tools: {tool_names}.\n{system_message}"
                    "For your reference, the current date is {current_date}. {instrument_context}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(tool_names=", ".join([tool.name for tool in tools]))
        prompt = prompt.partial(current_date=current_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        chain = prompt | llm.bind_tools(tools)

        result = chain.invoke(state["messages"])

        report = ""

        if len(result.tool_calls) == 0:
            report = result.content

        return {
            "messages": [result],
            "fundamentals_report": report,
        }

    return onchain_analyst_node
