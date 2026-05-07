# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

```bash
# Install in dev mode
pip install -e .

# Run the CLI (interactive analysis)
tradingagents
python -m cli.main

# Run tests
pytest                          # all tests
pytest -m unit                  # fast unit tests only
pytest -m "not integration"     # skip tests needing external services
pytest tests/test_memory_log.py -v

# Run a single ticker programmatically
python main.py

# Smoke-test structured output against a provider
python scripts/smoke_structured_output.py
```

## Architecture

**Orchestration layer** (`tradingagents/graph/`): A LangGraph `StateGraph` that chains agents in a fixed pipeline. `GraphSetup.setup_graph()` wires nodes and conditional edges; `ConditionalLogic` decides tool-loop routing and debate round gating. `TradingAgentsGraph` is the public entry point — it creates LLM clients, tool nodes, and the graph, then calls `propagate()` to run.

**Pipeline flow**: Analysts (market, social, news, onchain) run in sequence → Bull/Bear researchers debate → Research Manager produces investment plan → Trader proposes transaction → Aggressive/Conservative/Neutral risk analysts debate → Portfolio Manager issues final rating (Buy/Overweight/Hold/Underweight/Sell).

**Agent implementations** (`tradingagents/agents/`): Each agent is a function factory (`create_*`) that returns a callable taking `state: AgentState`. Structured-output agents (Research Manager, Trader, Portfolio Manager) use Pydantic schemas in `agents/schemas.py` with `with_structured_output()` — the schemas double as output instructions via field descriptions. Render helpers turn parsed instances back into markdown for downstream consumers.

**LLM clients** (`tradingagents/llm_clients/`): `create_llm_client()` factory lazily imports provider modules so importing the factory doesn't pull in heavy SDKs. OpenAI-compatible providers (openai, xai, deepseek, qwen, glm, ollama, openrouter) share `OpenAIClient`; Google, Anthropic, and Azure each have their own client. Structured output binding is provider-aware (`agents/utils/structured.py`).

**Data layer** (`tradingagents/dataflows/`): `route_to_vendor(method, *args)` is the single entry point — it resolves the configured vendor from config, builds a fallback chain across all available vendors, and calls the first one that succeeds. Category-level config (`data_vendors`) can be overridden per-tool (`tool_vendors`). Currently CCXT and CoinGecko are the primary vendors.

**State** (`tradingagents/agents/utils/agent_states.py`): `AgentState` extends LangGraph `MessagesState` with fields for each analyst report, debate substates, portfolio context, past memory context, and quant signal. `InvestDebateState` and `RiskDebateState` are `TypedDict` substates tracking debate history and round counts.

**Configuration** (`tradingagents/default_config.py`): All settings in a single `DEFAULT_CONFIG` dict. Key sections: `data_vendors`, `signal_weights`, `signal_thresholds`, `fixed_sizing`, `execution` (disabled by default — must toggle `execution.enabled`), `confidence_thresholds`. The `DEFAULT_CONFIG` is passed to `TradingAgentsGraph` and merged with user overrides.

**Memory system** (`tradingagents/agents/utils/memory.py`): `TradingMemoryLog` persists decisions to `~/.tradingagents/memory/trading_memory.md`. On each run, pending same-ticker entries are resolved with realised returns, alpha vs benchmark, and a structured reflection (see `ReflectionResult` schema). Past context is injected into the Portfolio Manager prompt.

**Checkpoint/resume** (`tradingagents/graph/checkpointer.py`): Opt-in via `--checkpoint`. Per-ticker SQLite databases under `~/.tradingagents/cache/checkpoints/`. Uses deterministic `thread_id(ticker, date)` so re-running the same ticker+date resumes; different dates start fresh. Checkpoints are cleared on successful completion.

**Exchange & execution** (`tradingagents/exchange/`, `tradingagents/risk/`, `tradingagents/portfolio/`): Execution is disabled by default (`execution.enabled: false`). When enabled, orders flow through `_execute_decision()` which validates the symbol, computes position sizing (LLM/fixed/Kelly/volatility/ATR modes), applies confidence-based penalties from the quant signal, checks risk limits, and places orders on a paper or live CCXT exchange.

## Key patterns

- **Tool nodes are crypto-native**: `_create_tool_nodes()` in `trading_graph.py` maps analyst types to `ToolNode` instances — no stock data tools remain.
- **Structured output with free-text fallback**: `invoke_structured_or_freetext()` in `agents/utils/structured.py` tries structured JSON first, falls back to free-text on failure, and logs a warning so providers that don't support structured output still work.
- **Rating extraction is deterministic**: `SignalProcessor.process_signal()` parses the PM's rendered markdown for `**Rating**: X` — no LLM call.
- **Analyst tool routing is greedy**: Each analyst node loops back to itself with tools until the LLM emits a response without `tool_calls`, then moves to the next analyst.
- **Debate rounds are configurable**: `max_debate_rounds` and `max_risk_discuss_rounds` control the Bull/Bear and Aggressive/Conservative/Neutral back-and-forth.
- **Quant signal is pre-computed**: `SignalEngine` runs before the graph and its output block is injected into the initial state, so all agents see the quant context. The confidence score from the engine gates execution (block below `force_hold`, scale below `penalty_50`/`penalty_70`).
- **Safe path handling**: `safe_ticker_component()` in `dataflows/utils.py` rejects ticker values containing path traversal patterns before they're used in file paths.
- **Lazy provider imports**: `create_llm_client()` in `llm_clients/factory.py` imports provider modules inside the function — tests can import the factory without needing API keys.
