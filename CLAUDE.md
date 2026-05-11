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

# Run a single ticker programmatically
python main.py

# Smoke-test structured output against a provider
python scripts/smoke_structured_output.py
```

## Architecture

**Orchestration layer** (`tradingagents/graph/`): LangGraph `StateGraph` built by `GraphSetup.setup_graph()` — analysts fan out in parallel, then merge into Bull/Bear → Research Manager → Trader → risk debate → Portfolio Manager → Scenario Planner → end. `ResearchAgentsGraph` is the public entry point (`TradingAgentsGraph` remains an alias for backward compatibility). `ConditionalLogic` handles analyst tool loops and debate/risk round gating. `JournalBridge` persists runs, snapshots, signals, opinions, debates, theses, and scenarios into SQLite via `JournalService`.

**Pipeline flow**: Selected analysts (market, social, news, onchain) run concurrently → Bull/Bear debate → Research Manager (investment plan) → Trader → Aggressive/Conservative/Neutral risk debate → Portfolio Manager (rating markdown) → Scenario Planner (structured `ScenarioPlan` when supported) → persisted thesis and scenarios.

**Agent implementations** (`tradingagents/agents/`): Factory functions (`create_*`) return callables over `AgentState`. Structured-output agents use Pydantic schemas in `agents/schemas.py` with `with_structured_output()`; `invoke_structured_or_freetext()` provides markdown rendering plus free-text fallback (`agents/utils/structured.py`).

**LLM clients** (`tradingagents/llm_clients/`): `create_llm_client()` lazily imports provider modules. OpenAI-compatible providers share `OpenAIClient`; Google, Anthropic, and Azure have dedicated clients.

**Data layer** (`tradingagents/dataflows/`): `route_to_vendor(method, *args)` resolves vendors and fallback chains. Historical replay sets `_replay` on config and uses `DataWindow` / `historical_contract.py` for no-lookahead semantics (`tradingagents/graph/historical_replay.py`).

**State** (`tradingagents/agents/utils/agent_states.py`): `AgentState` extends LangGraph `MessagesState` with report keys, debate substates, `scenario_plan`, `scenario_plan_json`, and quant signal text.

**Domain** (`tradingagents/domain/`): `ResearchRun`, `TradeThesis`, `Signal`, scenarios, decisions — see models there. `ResearchRun` can carry `config_hash` from `tradingagents/graph/config_hash.py` for reproducibility.

**Configuration** (`tradingagents/default_config.py`): Single `DEFAULT_CONFIG` dict. Key sections include `data_vendors`, `signal_weights`, `signal_thresholds`, `fixed_sizing`, and optional **`planning`**. Merge helpers live in `tradingagents/config/` and `planning_config()` in `tradingagents/graph/planning.py` when used.

**Decision journal** (`tradingagents/services/journal_service.py`, `tradingagents/storage/`): SQLite is the source of truth for research runs and artifacts; Markdown exports are snapshots only.

**Checkpoint/resume** (`tradingagents/graph/checkpointer.py`): Opt-in via `--checkpoint`. Per-ticker SQLite under `~/.tradingagents/cache/checkpoints/`. Replay runs append `:replay` to the thread id so they do not collide with live checkpoints.

**Historical replay CLI**: `python -m cli.main replay …` and `python -m cli.main research replay …` (`cli/replay_cmd.py`).

**Exchange & sizing** (`tradingagents/exchange/`, `tradingagents/risk/`, `tradingagents/portfolio/`): The graph does not place live orders; helpers support read-only/paper context when enabled in config.

## Key patterns

- **Tool nodes are crypto-native**: `create_tool_nodes()` in `research_agents_graph.py` maps analyst types to `ToolNode` instances.
- **Structured output with free-text fallback**: Used for Trader, Research Manager, Portfolio Manager, and Scenario Planner where the provider supports binding.
- **Rating extraction is deterministic**: `SignalProcessor.process_signal()` parses PM markdown for `**Rating**: X`.
- **Analyst tool routing**: Each analyst runner loops with tools until the model stops calling tools.
- **Quant signal is pre-computed**: `SignalEngine` output is injected into initial state for all agents.
- **Safe path handling**: `safe_ticker_component()` in `dataflows/utils.py` rejects path traversal in tickers used as path components.
- **Lazy provider imports**: `create_llm_client()` imports provider modules inside the factory.
