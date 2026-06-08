# Market Analyst

## Purpose

Market Analyst doc pre-computed quant signal va market context. No khong tu tinh lai signal chinh; vai tro la dien giai xem quant signal co hop ly khong, factor nao dang drive signal, co xung dot indicator nao khong, va nen dua gi cho Setup Planner.

## Code

- Factory: `apps/ai-service/luna_workstation/agents/analysts/market_analyst.py`
- Common runner: `apps/ai-service/luna_workstation/agents/utils/agent_utils.py`
- Graph registration: `apps/ai-service/luna_workstation/graph/setup.py`
- Node name: `Market Analyst`
- Selection key: `market`
- Report key: `market_report`
- Opinion key: `market_opinion`
- Source report type: `market`

## Inputs

- `company_of_interest`: exact ticker/pair.
- `trade_date`: run date.
- `messages`: current local analyst message list.
- `quant_signal`: pre-computed deterministic SignalEngine output.
- `market_context`: pre-computed market microstructure context.

## Tools

- `get_crypto_ohlcv`
- `get_indicators`
- `get_multi_timeframe_analysis`

Tools are optional verification tools. Prompt explicitly says the quant signal has already been computed and the analyst should not call signal-generation tools.

## What it does

1. Reads the pre-computed quantitative signal.
2. Reads pre-computed market context for ticker, spread, order book depth, recent trade VWAP, and cross-venue validation.
3. Interprets the quant factor breakdown, confidence, trend, and regime.
4. Checks whether factors conflict, for example RSI bullish while MACD bearish.
5. Optionally calls technical tools only to verify a factor or investigate conflict.
6. Writes a concise market report for downstream debate and Setup Planner.
7. Appends a Markdown factor table.
8. Runtime converts the report into a structured `AgentOpinion`.

## Guardrails

- Do not invent venues, prices, depth, or tape conditions absent from market context.
- Do not recompute the signal.
- Treat quant signal as primary baseline, not as a final decision.
- Preserve exact ticker via `build_instrument_context`.
- External/tool text is wrapped by `guard_untrusted_context`.

## Output

- `market_report`: rendered report or structured opinion rendering.
- `market_opinion`: structured JSON-compatible `AgentOpinion` when available.
- `messages`: last AI message from local analyst loop.

## Downstream consumers

- Bull Researcher
- Bear Researcher
- Research Manager indirectly through debate
- Setup Planner indirectly through Research Manager plan
- Risk analysts
- Portfolio Manager
- Trade Thesis evidence classification
