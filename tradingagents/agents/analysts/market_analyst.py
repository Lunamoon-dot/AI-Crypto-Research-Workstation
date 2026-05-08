from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    get_indicators,
    get_language_instruction,
    get_multi_timeframe_analysis,
)
from tradingagents.agents.utils.crypto_tools import get_crypto_ohlcv


def create_market_analyst(llm, config=None):

    def market_analyst_node(state):
        current_date = state["trade_date"]
        instrument_context = build_instrument_context(state["company_of_interest"])

        tools = [
            get_crypto_ohlcv,
            get_indicators,
            get_multi_timeframe_analysis,
        ]

        system_message = (
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
            + get_language_instruction(config=config)
        )

        # Inject the pre-computed quant signal into the system message
        quant_block = state.get("quant_signal", "")
        if quant_block:
            system_message += (
                f"\n\n===== PRE-COMPUTED QUANTITATIVE SIGNAL =====\n"
                f"{quant_block}\n"
                f"===== END SIGNAL =====\n"
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

        messages = state.get("market_messages", state.get("messages", []))
        result = chain.invoke(messages)

        report = ""

        if len(result.tool_calls) == 0:
            report = result.content

        return {
            "market_messages": messages + [result],
            "market_report": report,
        }

    return market_analyst_node
