# Technical Review: TradingAgents (Phase 1–9)

**Reviewer**: Senior Software Architect / Staff Engineer
**Date**: 2026-05-08
**Scope**: Phases 1 through 9 (full codebase analysis, ~180 source files across tradingagents/, cli/, tests/)
**Methodology**: Full read of all core modules, agent factories, graph orchestration, data flows, storage layer, tests, CI/CD, configuration, and CLI.

---

## Executive Summary

TradingAgents is a LangGraph-based multi-agent research workstation for crypto trading thesis generation. It chains LLM-powered analysts (market, social, news, onchain) through a debate-and-consensus pipeline culminating in a structured portfolio decision with a 5-tier rating. The system shows genuine engineering maturity in several areas — particularly the structured output fallback pattern, vendor abstraction layer, deterministic signal engine, and the memory/reflection system. However, it is held back by a handful of architectural anti-patterns that will become painful at scale: synchronous-only graph execution, rampant global mutable state, a 1600-line God-file CLI, and brittle markdown-based log parsing. The code feels like a skilled individual contributor operating without code review — there are flashes of senior-level design surrounded by junior-level shortcuts.

**Bottom line**: A promising research tool that needs a focused 2-4 week refactoring pass to be production-grade. In its current state, it is a **high-quality prototype** suitable for personal use and research exploration, but not ready for multi-user production deployment.

---

## 1. Major Strengths

### 1.1 Structured Output with Graceful Fallback (`agents/utils/structured.py`)
The `invoke_structured_or_freetext` pattern is one of the best pieces of engineering in this codebase. It tries `with_structured_output(PydanticSchema)` first, falls back to free-text on any failure, and logs a warning. This means providers that don't support structured output (DeepSeek reasoner, older Ollama models, etc.) still produce usable results. The `bind_structured` function explicitly returns `None` instead of raising, and all three decision-making agents (Research Manager, Trader, Portfolio Manager) use identical fallback logic through this shared utility. This is proper DRY with error resilience.

### 1.2 Vendor Abstraction with Fallback Chains (`dataflows/interface.py`)
The `route_to_vendor(method, *args)` entrypoint is cleanly designed. Tool-level vendor configuration takes precedence over category-level, and the system builds a fallback chain across all available vendors. If CCXT fails for a call, it falls through to CoinGecko automatically. The `VENDOR_METHODS` dispatch table makes it trivial to add new vendors — just register the function and add a config key. This is senior-level extensibility design.

### 1.3 Deterministic Signal Engine (`signals/engine.py`, `signals/composite.py`)
The quantitative signal layer is entirely decoupled from LLM agents. `SignalEngine.generate()` runs seven factor detectors deterministically from OHLCV/funding/OI/liquidation data, then `CompositeScorer.score()` produces a weighted composite with data quality adjustment, factor agreement bonus, and volatility discount. The confidence calculation has three components (directional strength, average effective confidence, agreement bonus) and four layers of volatility discounting. This is genuine quantitative analysis, not LLM fakery. Every factor signal carries a `data_quality` field that gates its contribution to the composite — thin-data signals pull less weight.

### 1.4 Lazy Provider Imports (`llm_clients/factory.py`)
`create_llm_client()` imports provider modules inside the function body. This means tests can `import tradingagents.llm_clients` without pulling in `langchain_openai`, `langchain_google_genai`, or `langchain_anthropic` — all heavy SDKs that require API keys. This is a small design decision with outsized benefits for test speed and developer experience.

### 1.5 Configuration Profile System (`config_manager.py`)
The config resolution chain (DEFAULT → profile file → CLI overrides) with deep merge and override-only storage (profiles only store diffs from defaults) is well thought out. The `_deep_merge` handles nested dicts correctly. Profile management commands (list, save, delete, load) have a clean API. Sensible defaults exist for everything.

### 1.6 Memory/Reflection System (`agents/utils/memory.py`, `graph/reflection.py`)
The append-only markdown log with pending→resolved lifecycle is simple but effective. No database dependency for the core reflection loop. The batch update with atomic write (temp file + os.replace) prevents log corruption. Rotation via `memory_log_max_entries` prevents unbounded growth. The same-ticker + cross-ticker context injection into the Portfolio Manager prompt closes the feedback loop without adding complexity. `Reflector` tunes its prompt by market type (spot vs futures) — attention to domain nuance.

### 1.7 Pydantic Domain Models (`domain/*.py`)
The domain layer has proper separation: `ResearchRun`, `TradeThesis`, `Signal`, `AgentOpinion`, `ResearchDebate`, `ThesisEvaluation`, `OutcomeReview`, `Scenario`, `Watchlist`, `MarketBrief`. Each model is a self-contained Pydantic BaseModel with clear field descriptions. The evaluation analytics module computes metrics by symbol, setup type, confidence bucket, signal, and agent — this is genuine quantitative self-assessment.

### 1.8 DeepSeek Thinking-Mode Round-Trip (`llm_clients/openai_client.py`)
The `DeepSeekChatOpenAI` subclass is a careful handling of a provider-specific quirk: DeepSeek's reasoning models require `reasoning_content` to be echoed back on subsequent turns or the API returns HTTP 400. The subclass intercepts `_create_chat_result` to capture the field and `_get_request_payload` to re-attach it. This is the kind of detail work that separates polished integration from "works on my machine."

### 1.9 SQLite Schema Design (`storage/schema.py`)
The journal schema has proper foreign keys, indexes on query patterns (symbol, created_at DESC, research_run_id), and a clean separation between entities. The `run_events` timeline table with thesis_id linkage enables full audit trails. `SQLiteStore._ensure_column` provides a primitive migration mechanism for additive schema changes.

### 1.10 Security Awareness in Path Handling
`safe_ticker_component()` in `dataflows/utils.py` rejects path traversal patterns (`../`, `..\\`) before ticker values are used in file paths. `config_manager._profile_path()` similarly sanitizes profile names. This shows security consciousness that many crypto projects miss entirely.

---

## 2. Major Weaknesses

### 2.1 Global Mutable Config State (`dataflows/config.py`) — CRITICAL
```python
_config: Optional[Dict] = None  # global mutable singleton
```
The entire data layer reads config from a module-level global that is mutated by `set_config()` at graph initialization time. This is a textbook anti-pattern:

- **Thread safety**: Two concurrent graph runs will corrupt each other's config. The second `set_config()` overwrites the first before `get_config()` is called.
- **Test pollution**: Tests that call `set_config()` leak state into subsequent tests unless explicitly reset.
- **Implicit coupling**: Every function that calls `get_config()` has an invisible dependency on whoever called `set_config()` last.

**Future consequence**: As soon as you try to run two analyses concurrently (even on different tickers), config parameters will leak between runs, producing silently wrong results.

**Fix**: Pass config explicitly through the call chain. The `ResearchAgentsGraph` already accepts a `config` dict — thread it through to `route_to_vendor` and `get_language_instruction` as a parameter rather than reading from a global.

### 2.2 Synchronous-Only Graph Execution — HIGH
Every node in the graph runs sequentially. The four analysts (market, social, news, onchain) could run in parallel — their inputs are independent (they each read from state and call different tools). The Bull and Bear researchers could run in parallel. Instead, the graph is a strict linear pipeline.

**Impact**: An analysis that could take 30 seconds with parallel analysts takes 2+ minutes sequentially. With LLM latency being the dominant cost (5-10s per tool-invocation loop), this is a 3-4x speed penalty.

**Fix**: Use LangGraph's `Send` API to fan out analysts in parallel at the START node, then aggregate results. The debate phase still needs sequential back-and-forth, but the initial research phase can be fully parallelized.

### 2.3 God-File CLI (`cli/main.py` — 1617 lines) — HIGH
This single file contains:
- TUI rendering logic (Rich layouts, panels, tables, spinners)
- Analysis orchestration (graph setup, streaming, state management)
- Report generation and disk I/O
- CLI argument parsing (Typer decorators)
- Message classification
- Agent status tracking
- Exception formatting for provider errors
- User input collection (interactive wizard)
- Configuration building from selections

None of these concerns are separated. Adding a new feature to the CLI means modifying this monolith. The `process_chunk` callback alone is 90 lines of nested if-statements checking for report fields by string key.

**Fix**: Extract `AnalysisOrchestrator`, `TuiRenderer`, `ReportWriter`, and `UserInputCollector` into separate modules. The `process_chunk` logic should be a state machine or at minimum a set of composable handlers.

### 2.4 God Class: `ResearchAgentsGraph` (~800 lines) — MEDIUM
The `ResearchAgentsGraph` class in `research_agents_graph.py` owns:
- LLM client creation and management
- Tool node creation
- Quantitative signal precomputation
- Return fetching for reflection
- Memory log resolution
- Graph execution (propagation)
- State logging to JSON
- Trade thesis building
- Trade plan building
- Symbol validation
- Journal persistence bridging

The class has 14 methods, several of which are 50+ lines. SRP violation is severe.

**Fix**: The journal bridge and planning already have their own modules — move the remaining orchestration concerns out. LLM client creation belongs in a factory at the graph module level, not as instance methods.

### 2.5 Regex-Based Markdown Log Parsing (`agents/utils/memory.py`) — MEDIUM
The memory log format is an ad-hoc text format parsed by regex:
```
[2026-01-10 | NVDA | Buy | +4.2% | +2.1% | 5d]

DECISION:
...markdown prose...
REFLECTION:
...more prose...
```
The parser (`_parse_entry`) splits on `|`, parses tags, extracts sections with regex. Each field position is positional and implicit. Adding a field means updating every parser path. The separator is an HTML comment (`<!-- ENTRY_END -->`) — clever but fragile if an LLM ever outputs that string.

**Fix**: Move to JSONL or SQLite for the memory log. Each entry is a JSON object on one line. Parsing becomes `json.loads(line)`. Or reuse the existing journal SQLite schema — the `TradeThesis` and `OutcomeReview` tables already model this data.

### 2.6 Exception Swallowing in JournalBridge — MEDIUM
Every method in `JournalBridge` wraps its body in `try/except Exception as e: logger.warning(...)`. If the database is corrupt, disk is full, or schema is wrong, the graph continues as if nothing happened. The user sees a warning in logs but gets a "successful" analysis with no persisted journal entry. This is silent data loss.

**Fix**: Distinguish between recoverable errors (transient DB lock) and non-recoverable errors (schema mismatch, disk full). Recoverable errors can be logged; non-recoverable errors should propagate to the caller so the user knows their analysis wasn't persisted.

### 2.7 No Async/Concurrency Support Anywhere — HIGH
The entire pipeline is synchronous. CCXT calls, LLM API calls, file I/O, database writes — all blocking. Python's `asyncio` is never used. LangGraph supports async graphs (`ainvoke`, `astream`), but this codebase never touches them.

**Impact**: 
- Cannot run multiple ticker analyses concurrently without multiprocessing
- WebSocket feed manager exists but will be blocked by synchronous graph runs
- Future web API layer would need a complete rewrite

### 2.8 Copy-Pasted Analyst Factories — LOW
The four analyst factories (`create_market_analyst`, `create_social_media_analyst`, `create_news_analyst`, `create_onchain_analyst`) share ~90% identical code. They differ only in the system prompt, tool list, and report field name. The `create_msg_delete` function is duplicated with different names.

**Fix**: A single `create_analyst(role, tools, report_key, system_prompt)` factory with parameterized differences.

---

## 3. Critical Technical Debt

### 3.1 No Database Migration System
`SQLiteStore._ensure_column()` does `ALTER TABLE ADD COLUMN` ad-hoc. There's no version tracking, no downgrade path, no migration ordering. If two branches both add columns to the same table, merging produces conflicts at the application level rather than the schema level.

**Fix**: Adopt Alembic or a simple versioned migration system. The `SCHEMA_SQL` constant is already well-structured — add a `schema_version` table and migration scripts.

### 3.2 No Structured Logging / Tracing
All logging uses `logger = logging.getLogger(__name__)` with `%s` formatting. There's no OpenTelemetry, no trace IDs, no span context. When an analysis fails, you're grep-ing log files by timestamp. With 14 agents doing LLM calls and tool invocations, debugging a bad output is painful.

**Fix**: Add `structlog` or at minimum inject a `run_id` into all log messages. For production, integrate OpenTelemetry spans for each graph node.

### 3.3 No Proper Error Boundaries Between Graph Nodes
If the Market Analyst node raises an exception, the entire graph fails. There's no per-node error boundary that captures the exception into state and continues with a degraded analysis (market_report = "Error: ..."). LangGraph supports this via `retry` policies, which are not used.

### 3.4 Tests Are Heavily Over-Mocked
The test suite (`tests/`) has 20 test files, ~500 test cases — good coverage in raw numbers. But:
- `conftest.py` monkeypatches all API key env vars to "placeholder" — tests never hit real APIs
- `TradingAgentsGraph._fetch_returns` is tested via `MagicMock(spec=TradingAgentsGraph)` — testing a mock, not the real code
- No integration test runs the full graph pipeline with a real LLM
- Most "unit" tests test mock interactions, not behavior

**Fix**: Add a `tests/integration/` directory with at least one end-to-end test that runs the graph against a real LLM (with a CI-only API key). Use snapshot testing for structured outputs.

### 3.5 No Rate Limiting or Retry Logic in Tool Calls
CCXT calls have `enableRateLimit: True` in some places but not all. LLM calls have a 5-minute timeout but no retry on 429/503. A rate limit from Binance or OpenAI kills the entire analysis with no recovery.

### 3.6 Inconsistent Use of `Optional[X]` vs `X | None`
The codebase uses both `Optional[str]` and `str | None` interchangeably, sometimes in the same file. `from __future__ import annotations` enables PEP 604 syntax, but older code paths still use `Optional`. Not a bug, but it signals that the codebase grew without linting enforcement.

---

## 4. Hidden Technical Risks

### 4.1 Concurrent CCXT Exchange Object Creation
`_validate_symbol_on_exchange` creates a fresh CCXT exchange instance on every call. If two threads call this simultaneously with the same exchange, they both call `exchange.load_markets()` — which downloads the full market list (~2000+ symbols) from the exchange API. This is:
- Slow (~2-5 seconds)
- Rate-limit-consuming
- Potentially conflicting if CCXT has internal caching issues

### 4.2 Prompt Injection via Memory Log
The `get_past_context` method injects past decisions and reflections directly into the Portfolio Manager's prompt. If a previous LLM-generated reflection contains control-like text ("Ignore all previous instructions..."), it will be injected verbatim into the next run's prompt. There's no sanitization.

### 4.3 Silently Wrong Symbol Normalization
`_validate_symbol_on_exchange` normalizes `"BTC"` → `"BTC/USDT"` with a warning log. If a user typed `"BTC"` expecting Bitcoin but the system resolved it to a different exchange's BTC pair with different quote currency, the analysis proceeds on the wrong instrument with only a log warning.

### 4.4 Deterministic thread_id Enables Resume, Disables Parallelism
`thread_id(ticker, date)` generates deterministic LangGraph thread IDs. This means re-running the same ticker+date resumes from the last checkpoint. But it also means you cannot run two analyses for the SAME ticker+date in parallel (they'd share a thread_id and corrupt each other's checkpoints).

### 4.5 Reports/ Directory in Git
The `reports/` directory contains actual analysis reports committed to version control. These may contain sensitive trading analysis. Even if public, they pollute the repo with generated content.

---

## 5. Scalability Assessment

| Dimension | Current | Limit | Breaking Point |
|-----------|---------|-------|----------------|
| Tickers per run | 1 | 1 (hard-coded) | Parallelism needed for multi-ticker |
| Concurrent users | 1 | 1 (global state) | Config corruption at 2+ |
| Data vendors | 2 (CCXT, CoinGecko) | ~5 easily | Add CryptoPanic, Glassnode, etc. |
| Memory log entries | Unlimited (with rotation) | ~1000 before parsing slow | O(n) full-read on every `load_entries()` |
| SQLite journal | Good | ~100K rows before performance degrades | Single-file SQLite, no WAL mode |
| LLM providers | 8 (via factory) | Unlimited via OpenAI-compat | Adding a non-OpenAI-compat provider requires a new client class |
| Graph nodes | 14 | ~30 before graph becomes unreadable | LangGraph handles this well |
| Agent debate rounds | Configurable (1-∞) | 3-5 practical limit | LLM context window saturation |

**Verdict**: Scales vertically for a single researcher. Will not scale horizontally without significant refactoring of global state and synchronous execution.

---

## 6. Production Readiness Assessment

| Area | Status | Notes |
|------|--------|-------|
| Error handling | Partial | LLM fallback is good; tool errors kill the pipeline |
| Configuration management | Good | Profiles, deep merge, env var overrides |
| Logging | Basic | Standard library logging, no structured fields |
| Monitoring | None | No metrics, health checks, or alerting |
| Testing | Fair | Good unit coverage, zero integration tests |
| CI/CD | Minimal | Compile check, import smoke test, Ruff critical checks |
| Containerization | Good | Multi-stage Dockerfile, docker-compose.yml |
| Documentation | Good | Comprehensive CLAUDE.md, README, TERMINAL_UX_GUIDE |
| Graceful degradation | Partial | Structured→freetext fallback; no analyst-level degradation |
| Data validation | Partial | Symbol sanitization; no OHLCV quality checks |
| API versioning | None | CCXT/LLM SDK versions pinned in pyproject.toml |

**Verdict**: Not production-ready. Suitable as a personal research tool. Could be production-ready after ~4 weeks of focused hardening.

---

## 7. Security Assessment

| Concern | Severity | Details |
|---------|----------|---------|
| API key management | Medium | Keys from env vars, standard practice for CLI tools. `.env` in `.gitignore` but `.env.enterprise.example` committed. |
| Path traversal protection | Safe | `safe_ticker_component()` rejects `../` patterns |
| Prompt injection | Low-Medium | Memory log injection into PM prompt; untrusted reflection text |
| SQL injection | Safe | Parameterized queries via `sqlite3` placeholders |
| Dependency supply chain | Medium | No hash pinning in pyproject.toml or uv.lock reviewed |
| YAML deserialization | Safe | `yaml.safe_load()` used consistently |
| No auth/authz | N/A | Single-user CLI tool, no network server |
| CCXT exchange keys | Medium | If execution is enabled, exchange API keys stored in env vars — standard but worth auditing |

**Verdict**: Acceptable for a local CLI tool. The prompt injection concern via memory log is the most interesting vector — an adversary who can influence past reflection text could influence future trading decisions.

---

## 8. Performance Assessment

| Operation | Estimated Cost | Bottleneck |
|-----------|---------------|------------|
| OHLCV fetch (CCXT) | 0.5-2s | Network I/O, rate limiting |
| Technical indicators | <100ms | Pure Python, pandas — fast |
| Signal engine | <50ms | All deterministic computation |
| LLM analyst call | 3-10s each | API latency, token generation |
| Full graph run | 60-180s | Sequential LLM calls dominate |
| Memory log load | <10ms (<1000 entries) | Full file read + regex parse |

**Key insight**: LLM latency is 95%+ of total runtime. Any optimization that doesn't reduce LLM calls or parallelize them is negligible. The signal engine could run in 0.001ms and it wouldn't matter.

**Optimization priorities**:
1. Parallelize analyst research phase (4 analysts × 5s → 5s instead of 20s)
2. Cache OHLCV data per ticker+date
3. Use streaming LLM responses where possible (already partially implemented)
4. Skip analysts whose signal contribution would be zero (e.g., no onchain data available)

---

## 9. Refactor Priorities (Highest ROI First)

### Priority 1: Eliminate Global Mutable Config (2-3 days)
Thread `config` through function parameters instead of `get_config()` global. Every module that currently calls `get_config()` should receive config as an explicit parameter. The `ResearchAgentsGraph` already holds a config reference — propagate it downward.

### Priority 2: Parallelize Analyst Phase (3-5 days)
Use LangGraph's `Send` API to run market, social, news, and onchain analysts as parallel branches from START. Aggregate their outputs before the debate phase. This alone cuts runtime by ~40%.

### Priority 3: Split CLI main.py (2-3 days)
Extract at minimum:
- `cli/analysis_runner.py` — graph orchestration
- `cli/tui_renderer.py` — Rich layout and display
- `cli/report_writer.py` — disk I/O for reports
- `cli/interactive_wizard.py` — user input collection

### Priority 4: Add Integration Tests (2-3 days)
One end-to-end test per LLM provider. One full-pipeline test with a known ticker (BTC/USDT) and snapshot assertions on structured outputs.

### Priority 5: Structured Logging (1-2 days)
Add `run_id` to all log messages. Use `structlog` with JSON output. Add per-node timing instrumentation.

### Priority 6: Memory Log → JSONL (1-2 days)
Replace the markdown-based log format with JSONL. Each entry is a single JSON object. Reads become `json.loads(line)` instead of regex parsing. Backward-compatible with a migration script.

---

## 10. Engineering Maturity Estimation

**Overall: 6.5/10** — Strong individual contributor, limited team process.

| Dimension | Score | Evidence |
|-----------|-------|----------|
| Architecture design | 7/10 | Clean pipeline concept, good domain modeling |
| Code organization | 6/10 | Good module structure, but God classes exist |
| Error handling | 5/10 | Good LLM fallback, poor tool error handling |
| Testing | 5/10 | Good unit coverage, zero integration tests |
| Documentation | 8/10 | Excellent CLAUDE.md, good inline comments |
| API design | 7/10 | Clean factory patterns, good interface abstractions |
| Security awareness | 6/10 | Path sanitization present, no auth model needed |
| Performance awareness | 5/10 | No parallelism, no caching strategy |
| Operational readiness | 3/10 | No monitoring, no health checks, no structured logging |
| Dependency management | 6/10 | pyproject.toml is clean, but no hash pinning |

---

## 11. Commercial / Open-Source Potential

### Strengths for Open Source
- **Local-first**: No cloud dependency, runs on consumer hardware
- **Provider-agnostic**: Works with 8+ LLM providers
- **Crypto-native**: Real CCXT/CoinGecko integration, not stock data repurposed
- **Structured output**: Produces typed, parseable decisions
- **Memory/learning**: The reflection system is a genuine differentiator vs. other "AI trading" projects
- **CLI polish**: Rich TUI with live progress, multi-panel layout

### Weaknesses for Open Source
- **No onboarding experience**: First run requires API keys, model selection, exchange config
- **No "quick start" mode**: Can't run `tradingagents BTC/USDT` without 10 interactive prompts
- **Missing crucial crypto data**: News, social sentiment, and onchain data are mostly placeholder/stub functions
- **No backtesting credibility**: The backtesting runner exists but measures thesis quality, not PnL — hard to market as a trading tool

### Commercial Potential
The underlying architecture (multi-agent debate → structured decision → memory feedback) is valuable beyond crypto. With a different data vendor layer, this could analyze stocks, commodities, or any instrument with OHLCV data. The thesis evaluation system is a genuine quantitative research tool. However, the crypto-specific tools (funding rate, OI, liquidations) are where the system adds unique value — a stock version would lose much of the signal engine's power.

**Verdict**: Strong open-source potential as a research framework. Limited commercial potential in current form due to production-readiness gaps. Could be valuable as a white-label research platform if the scalability and operational concerns are addressed.

---

## 12. Final Verdict

### Scores (1-10)

| Category | Score |
|----------|-------|
| Architecture | 7 |
| Code Quality | 6 |
| Domain Modeling | 8 |
| Error Resilience | 5 |
| Test Coverage | 4 |
| Performance | 4 |
| Security | 6 |
| Documentation | 8 |
| Operational Readiness | 3 |
| Extensibility | 7 |
| Overall | **5.8/10** |

### Summary

TradingAgents is a **technically ambitious, well-conceived research tool** built by a developer who clearly understands both crypto markets and software architecture. The structured output fallback pattern, vendor abstraction, deterministic signal engine, and memory/reflection loop are genuinely impressive pieces of engineering that most "AI trading" projects never achieve.

However, the codebase has the characteristic profile of a solo developer building fast without review: flashes of brilliance surrounded by pragmatic-but-unsustainable shortcuts. The global mutable config, synchronous-only execution, God-file CLI, and lack of integration tests are not bugs — they're architectural choices that were correct for velocity but will become incorrect as the project grows.

**What to keep**: The core pipeline, domain models, signal engine, vendor abstraction, memory system, and structured output pattern are all worth preserving. These are solid foundations.

**What to rewrite**: The CLI needs a full separation of concerns. The config system needs to go from global singleton to dependency injection. The graph needs parallel execution branches. The memory log format needs to move from markdown to structured data.

**If I were the technical lead**: I would freeze feature work for 2-3 weeks and execute the refactor priorities above, in order. The result would be a genuinely production-grade research platform. The current code is a very good prototype that's one refactoring pass away from being excellent.

---

*This review reflects the codebase as of Phase 9. Many of the patterns criticized here (global state, God classes, synchronous execution) are natural consequences of rapid prototyping. The author clearly knows they exist — the CLAUDE.md and code comments show awareness of trade-offs. The question is not whether these issues exist, but when they get addressed.*
