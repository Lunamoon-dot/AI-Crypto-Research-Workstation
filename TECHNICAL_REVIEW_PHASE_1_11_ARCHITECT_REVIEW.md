# LunaCrypto / LunaPerception Technical Review - Phase 1-11

Date: 2026-05-13  
Reviewer stance: senior software architect / staff engineer  
Scope: phases 1-11 only, focused on the local Python AI research workstation under `apps/ai-service`.

## 0. Scope And Verification

This review intentionally excludes Phase 12+ as a scored target. The NestJS API and Prisma package are useful context, but the verdict below is about the product promised by phases 1-11: a local-first crypto research workstation with multi-agent research, deterministic signals, journaling, replay/evaluation, reliability policy, and observability.

Commands verified during review:

| Gate | Result |
|---|---:|
| `python -m ruff check .` in `apps/ai-service` | Pass |
| `python -m ruff format --check .` in `apps/ai-service` | Pass |
| `python -m mypy tradingagents cli` in `apps/ai-service` | Pass, but with relaxed mypy policy |
| `python -m pytest -q` in `apps/ai-service` | `573 passed, 42 subtests passed` |
| `pnpm build:api` | Pass |
| `pnpm --filter @lunaperception/api test` | Pass, 14 tests |
| `pnpm lint` | Pass |

Approximate code size inspected:

| Area | Files | Lines |
|---|---:|---:|
| Python AI service: `tradingagents`, `cli`, tests | 249 | 39,739 |
| API/database context: `apps/api`, `packages/database/prisma` | 43 | 4,021 |

## 1. Overall Project Purpose

The project is not a trading bot, and that is one of its better architectural decisions. The real product is a local-first crypto research workstation:

1. collect market data from configured providers;
2. compute deterministic signal snapshots;
3. run a multi-agent research graph;
4. produce a trade thesis, scenarios, risk debate, and portfolio decision;
5. persist the decision process into a local SQLite journal;
6. later review outcomes and reliability.

The implied product is closer to "Obsidian/Cursor for crypto research" than to an exchange execution system. That distinction matters. It lowers regulatory blast radius, makes the journal the core asset, and makes explainability more important than automated execution.

The codebase mostly understands this. The domain model has `ResearchRun`, `Signal`, `TradeThesis`, `Scenario`, `UserDecision`, `OutcomeReview`, provider health, LLM call logs, freshness checks, watchlists, alerts, briefs, and reliability snapshots. This is a real product shape, not a weekend wrapper around an LLM.

## 2. Executive Verdict

This is a strong local alpha/beta research engine with better-than-average engineering discipline for an LLM-heavy project. It has meaningful domain boundaries, deterministic signal layers, persistent journals, config policy, tests, and observability. It is not yet production-grade as a trust-sensitive financial research product.

The biggest issue is not that tests are missing. The biggest issue is that some of the most important trust claims, especially historical replay/no-lookahead and journal completeness, are not enforced as hard invariants. A research product can survive a weaker UI. It cannot survive users believing a replay or confidence score that quietly used contaminated data or lost artifacts.

Overall Phase 1-11 score: **7.3 / 10**

Interpretation:

- Good enough for serious local internal use.
- Good enough for a controlled beta with clear disclaimers.
- Not good enough for hosted SaaS, regulated workflows, or claims of statistically valid backtesting.
- Not ready for autonomous execution, and the codebase is correct not to go there yet.

## 3. Major Strengths

### 3.1 Clear Product Boundary

The project consistently frames itself as research support, not execution. That is visible in the docs, journal-first workflow, and lack of broker/order APIs in the active Phase 1-11 product surface.

Why it is good:

- It avoids premature coupling to exchanges, custody, order routing, and compliance-heavy execution paths.
- It keeps the core value in explainability, memory, and repeatable research.
- It makes local-first deployment credible.

Senior-level signal:

- The product does not chase the most dangerous feature first. It builds decision support before execution.

### 3.2 Domain Model Is Real

The model is not just `prompt -> response`. The system captures runs, signals, thesis, scenarios, debates, user decisions, outcomes, provider health, LLM calls, freshness checks, briefs, alerts, and reliability.

Good examples:

- `apps/ai-service/tradingagents/services/journal_service.py`
- `apps/ai-service/tradingagents/storage/schema.py`
- `apps/ai-service/tradingagents/graph/run_orchestrator.py`
- `apps/ai-service/tradingagents/signals/composite.py`
- `apps/ai-service/tradingagents/signals/provenance.py`

Why it matters:

- The journal is the product moat. If this becomes commercially useful, it will be because it accumulates structured research memory, not because it can call an LLM.
- The schema anticipates auditability and retrospective learning.

### 3.3 Deterministic Signals Before LLM Reasoning

The system computes deterministic signals and then feeds those into agent reasoning. This is the correct direction. LLMs are used to synthesize and debate, while numeric market inputs have a separate provenance and confidence layer.

Why it is good:

- It reduces hallucination risk.
- It allows future calibration of signal quality.
- It keeps market evidence inspectable.

This is one of the strongest engineering choices in the repo.

### 3.4 LangGraph Orchestration Has A Coherent Shape

The multi-agent graph has a recognizable product flow: analysts, bull/bear debate, research manager, setup planner, risk debate, portfolio decision, scenario planning. The architecture is ambitious but not random.

Good signs:

- Analyst definitions are centralized rather than scattered.
- Graph fan-out uses explicit analyst definitions.
- There are structured output parsers and fallback paths.
- The run orchestrator persists timeline and quality information.

### 3.5 Configuration, Secrets, And Production Policy Are Better Than Prototype Grade

The config layer has TOML/env/profile layering, production policy, secret loading, and provider reliability settings.

Good examples:

- `apps/ai-service/tradingagents/config/loader.py`
- `apps/ai-service/tradingagents/config/schema.py`
- `apps/ai-service/tradingagents/config/secrets.py`

This is a meaningful maturity marker. Many LLM projects stay at `.env` plus globals. This repo is past that.

### 3.6 Prompt Injection Awareness Exists

The repo has explicit utilities for untrusted context and ticker sanitization. That matters because market data, news, social text, and tool outputs are all possible prompt injection carriers.

Good example:

- `apps/ai-service/tradingagents/agents/utils/agent_utils.py`

This does not make the system secure by itself, but it shows the developer is thinking about the right class of failure.

### 3.7 Test Volume And CI Are Strong For Phase 1-11

`573` Python tests passing is meaningful. The CI also runs ruff, format checks, mypy, compile checks, and separate Python test classes.

Good example:

- `.github/workflows/ci.yml`

This is much better than most early LLM app repos.

## 4. Major Weaknesses

### 4.1 Historical Replay Is Not Trustworthy Enough Yet

This is the most important hidden risk.

Evidence:

- `apps/ai-service/tradingagents/dataflows/historical_contract.py:23` defines `TimestampSemantics`.
- `apps/ai-service/tradingagents/dataflows/historical_contract.py:41` defines `HYBRID`.
- `apps/ai-service/tradingagents/dataflows/historical_contract.py:216` rejects `LATEST` when `AS_OF` is required, but `HYBRID` can pass.
- `apps/ai-service/tradingagents/graph/historical_replay.py:344` uses `AS_OF` in strict mode and `HYBRID` otherwise.
- `apps/ai-service/tradingagents/dataflows/interface.py:372` routes historical vendor calls.
- `apps/ai-service/tradingagents/dataflows/ccxt_provider.py:371` defines funding-rate history.
- `apps/ai-service/tradingagents/dataflows/ccxt_provider.py:388` computes funding history from `datetime.now(timezone.utc) - timedelta(days=days)`.
- `apps/ai-service/tradingagents/dataflows/ccxt_provider.py:464` defines open-interest history.
- `apps/ai-service/tradingagents/dataflows/ccxt_provider.py:480` also anchors open interest to `datetime.now(timezone.utc)`.
- `apps/ai-service/tradingagents/graph/historical_replay.py:96` initializes `_data_call_log`, but the reviewed routing path does not populate enough audit detail to prove no-lookahead.
- `apps/ai-service/tradingagents/graph/historical_replay.py:377` writes replay audit event with `research_run_id=""`, while `apps/ai-service/tradingagents/storage/schema.py:201` defines `run_events.research_run_id TEXT NOT NULL`.

Why this is problematic:

Replay is a trust feature. If a historical thesis can accidentally use today's funding or open-interest window, the evaluation result becomes contaminated. The user may believe the system would have known something at the historical decision time that it could not actually know.

Future consequence:

- Reliability scores become misleading.
- Product claims around replay, evaluation, or "would this thesis have worked" become unsafe.
- If commercialized, this is the kind of issue that destroys trust quickly because users will make decisions based on an apparently scientific artifact.

Better approach:

- In strict replay, require every provider method to be `AS_OF`, not `HYBRID`.
- Add explicit `as_of` / `end_time` parameters to funding, open-interest, indicators, and all replay-relevant provider methods.
- Reject provider methods that derive ranges from `now()` when a replay contract is active.
- Persist replay audit events against a real run ID or a dedicated replay session table.
- Make `ReplayResult.data_call_log` a mandatory evidence artifact, populated by the data routing layer.
- Add tests that assert every provider call during replay requests data with `timestamp <= replay_date`.

### 4.2 Journal Persistence Is Too Best-Effort For A Trust Layer

Evidence:

- `apps/ai-service/tradingagents/graph/journal_bridge.py:62` tracks `_persist_failures`.
- `apps/ai-service/tradingagents/graph/journal_bridge.py:85` increments failures.
- `apps/ai-service/tradingagents/graph/journal_bridge.py:102` emits `journal_persistence_degraded`.
- `apps/ai-service/tradingagents/services/journal_service.py:742` applies completion quality.

Why this is problematic:

The journal is the product's memory and audit trail. If persistence failures are mostly logged and tolerated, the system can produce a research result while losing the artifacts that make the result trustworthy.

Future consequence:

- Users will see completed research while the local journal is incomplete.
- Outcome review and reliability calculations become biased because failed writes quietly remove bad or partial runs.
- Debugging provider/model behavior becomes harder because the audit trail has gaps.

Better approach:

- Classify persistence writes by criticality.
- Run creation, thesis persistence, signal snapshots, and terminal run status should be critical.
- If critical writes fail, mark the run `FAILED` or `COMPLETED_DEGRADED` and surface this to CLI/API output.
- Add an explicit "journal integrity" result field that is not hidden in logs.

### 4.3 The Graph Has Legacy Dead Code And Duplicate Paths

Evidence:

- `apps/ai-service/tradingagents/graph/research_agents_graph.py:504` defines `_build_trade_thesis`.
- `apps/ai-service/tradingagents/graph/research_agents_graph.py:509` returns `ThesisBuilder(self).build(final_state)`.
- Code after that return is unreachable legacy logic.
- `apps/ai-service/tradingagents/graph/run_orchestrator.py:174` has the newer `run_graph`.
- `apps/ai-service/tradingagents/graph/research_agents_graph.py:940` still has old run completion logic.
- `apps/ai-service/tradingagents/graph/research_agents_graph.py:962` calls `_complete_journal_run()` in the older path.

Why this is problematic:

Dead code in orchestration logic is dangerous because maintainers cannot easily tell which path is authoritative. In a graph-based LLM system, behavior is already difficult to reason about. Duplicate orchestration paths multiply that complexity.

Future consequence:

- Bug fixes get applied to the wrong implementation.
- Tests may cover one path while CLI/API uses another.
- Staff-level architectural intent gets buried under compatibility residue.

Better approach:

- Delete unreachable code.
- Keep `ResearchAgentsGraph` as a composition shell.
- Move orchestration, thesis building, journal bridging, and data loading into clearly owned modules.
- Add tests that assert the public graph entrypoint uses only the intended orchestrator path.

### 4.4 Freshness Policy Is Not Fully Config-Driven

Evidence:

- `apps/ai-service/tradingagents/signals/provenance.py:32` defines `FRESHNESS_WINDOW = timedelta(hours=24)`.
- `apps/ai-service/tradingagents/signals/provenance.py:85` uses that constant for freshness.
- `apps/ai-service/tradingagents/signals/provenance.py:100` logs threshold using the hard-coded 24h window.
- `apps/ai-service/tradingagents/signals/provenance.py:135` emits the hard-coded threshold.

Why this is problematic:

The config layer exposes stale-data policy, but a key freshness path still uses a constant. This makes configuration partly performative.

Future consequence:

- A user or deployment may believe it has tightened stale-data policy while the signal provenance path still uses 24 hours.
- Market regimes with different data freshness needs cannot be configured reliably.

Better approach:

- Pass freshness policy through the signal conversion pipeline.
- Make `FRESHNESS_WINDOW` a default, not the effective policy.
- Add a test that changes config `max_age_hours` and verifies the emitted freshness threshold changes.

### 4.5 Mypy Passing Overstates Type Safety

Evidence:

- `apps/ai-service/pyproject.toml:74` sets `ignore_missing_imports = true`.
- `apps/ai-service/pyproject.toml:78` sets `disallow_untyped_defs = false`.
- `apps/ai-service/pyproject.toml:79` sets `check_untyped_defs = false`.
- `apps/ai-service/pyproject.toml:95` ignores errors in selected modules.

Why this is problematic:

The project can say "mypy passes", but large amounts of runtime-heavy logic may not actually be checked deeply. This matters in agent orchestration because state dictionaries, structured outputs, optional fields, and persistence payloads are easy to break during refactors.

Future consequence:

- Regressions appear only at runtime.
- Type contracts between graph nodes, journal service, and API boundary remain weaker than they look.
- New contributors may assume mypy gives more safety than it does.

Better approach:

- Turn on `check_untyped_defs` for core modules first.
- Add strict typing slices around graph state, journal service, data provider contracts, and engine JSON contract.
- Use typed protocols for providers and graph nodes instead of passing broad dictionaries everywhere.

### 4.6 Provider Timeout Strategy Can Leak Work Under Outage

Evidence:

- `apps/ai-service/tradingagents/dataflows/interface.py:6` imports `ThreadPoolExecutor`.
- `apps/ai-service/tradingagents/dataflows/interface.py:498` defines `_invoke_with_resilience`.
- `apps/ai-service/tradingagents/dataflows/interface.py:524` creates `ThreadPoolExecutor(max_workers=1)` per provider call.
- `apps/ai-service/tradingagents/dataflows/interface.py:484` applies vendor rate limiting with a global lock and `time.sleep`.
- `apps/ai-service/tradingagents/dataflows/interface.py:369` async routing is implemented with `asyncio.to_thread`.

Why this is problematic:

Cancelling a future does not necessarily stop a blocking network call already running in a thread. Creating a new executor per call can leave background work around during provider outages. The async API is also not true async I/O; it is sync work moved to threads.

Future consequence:

- Under provider degradation, the system may accumulate stuck threads.
- Concurrent watchlists or scheduled briefs will serialize or block more than expected.
- Latency and resource usage become unpredictable.

Better approach:

- Use native timeout support in HTTP clients and provider SDKs.
- Prefer `httpx.AsyncClient` or provider-native async clients for network-bound paths.
- Use bounded shared executors if sync provider calls must remain.
- Make cancellation and timeout behavior observable with per-provider metrics.

### 4.7 Retry And Fallback Policy Can Mask Programming Errors

The LLM orchestration layer has provider fallback and retry behavior, which is useful. The risk is that unknown failures can be treated as retryable and entire graph execution can be rerun.

Why this is problematic:

Retries are correct for transient provider failures. They are not correct for schema bugs, parser regressions, state corruption, or persistence side effects.

Future consequence:

- Real bugs get hidden behind provider fallback.
- LLM cost can spike under deterministic failures.
- Re-running larger graph sections can duplicate side effects unless every write is idempotent.

Better approach:

- Define an explicit error taxonomy: provider transient, provider permanent, parser contract failure, application bug, persistence failure, policy violation.
- Retry only known transient failures.
- Prefer node-level/stage-level retry over whole-graph retry.
- Attach idempotency keys to persistence events.

### 4.8 Confidence And Reliability Are Still Heuristic

The deterministic signal layer is clean, but confidence and scoring are still mostly heuristic.

Why this is problematic:

A numeric score looks authoritative. If it is not empirically calibrated, users will over-trust it.

Future consequence:

- The UI/API may eventually present confidence as if it were probability.
- Reliability snapshots may reinforce false precision.
- Commercial users will ask, correctly, whether scores are predictive.

Better approach:

- Separate `heuristic_confidence` from `empirical_confidence`.
- Require sample size and out-of-sample evaluation before displaying reliability as performance.
- Version signal weights and persist the version used for every thesis.
- Build calibration reports per symbol/regime/timeframe.

### 4.9 SQLite Schema Is Good For Local Use, Painful For Multi-Tenant Product Use

The SQLite schema is rich and appropriate for local-first usage. The risk is future product migration.

Why this is problematic:

Some SQLite tables are local-run oriented and do not consistently carry workspace boundaries. The Phase 12 Prisma schema moves toward workspace-aware product architecture, but that means there are two schema worlds that need reconciliation.

Future consequence:

- Hosted migration will be more than "swap SQLite for Postgres".
- Analytics queries and access control will require backfilling tenant/workspace identity.
- Local-to-cloud sync will need conflict and identity semantics that are not yet clearly modeled in Phase 1-11.

Better approach:

- Keep SQLite as the local source of truth, but define a canonical sync contract.
- Add stable IDs, workspace/user identity, schema versions, and migration fixtures.
- Decide whether local journal and cloud database are equivalent schemas or intentionally different projections.

### 4.10 CI Is Good, But Release Gates Are Incomplete

Evidence:

- `.github/workflows/ci.yml:90` runs ruff.
- `.github/workflows/ci.yml:93` runs format check.
- `.github/workflows/ci.yml:117` runs mypy.
- `.github/workflows/ci.yml:172` and `:188` run pytest classes.
- No evidence in the CI workflow of Docker image build, dependency audit, secret scan, migration smoke test, or coverage threshold.

Why this is problematic:

Passing unit/integration tests does not mean the artifact is releasable. This is especially true for a project with external providers, secrets, local database migrations, Docker, and scheduled research flows.

Future consequence:

- A broken Dockerfile can ship unnoticed.
- Vulnerable dependencies can remain invisible.
- Coverage may regress while test count remains high.
- Secret leaks may only be caught manually.

Better approach:

- Add Docker build as a CI gate.
- Add `pip-audit`/`uv audit` and `pnpm audit` or equivalent policy.
- Add `gitleaks` or `detect-secrets`.
- Add coverage thresholds for core modules.
- Add SQLite migration and backup/restore smoke tests.

### 4.11 CLI File Logging Can Bypass Central Redaction Assumptions

Evidence:

- `apps/ai-service/tradingagents/observability/logging.py:67` defines `redact_secrets`.
- `apps/ai-service/tradingagents/observability/logging.py:83` defines `SecretRedactionFilter`.
- `apps/ai-service/cli/orchestrator.py:149` writes `message_tool.log`.
- `apps/ai-service/cli/orchestrator.py:303` wires log decorators.

Why this is problematic:

Central logging redaction exists, but custom file logs and monkey-patched message/tool logging may not consistently pass through it. Right now this may be low-risk if tool args are clean. It becomes high-risk the first time headers, URLs, provider payloads, or raw exceptions include tokens.

Future consequence:

- Local logs can leak API keys or provider credentials.
- Users may attach logs to issues and accidentally disclose secrets.

Better approach:

- Route all file logs through the same redaction function.
- Redact by key and by value shape where possible.
- Avoid logging raw tool arguments unless explicitly marked safe.

### 4.12 Dependency And Naming Debt Create Product Confusion

Evidence:

- `apps/ai-service/pyproject.toml:13` includes `backtrader`.
- `apps/ai-service/pyproject.toml:26` includes `redis`.
- `apps/ai-service/pyproject.toml:34` includes `yfinance`.
- The Python package still uses `tradingagents` naming.

Why this is problematic:

The product says "research workstation, not execution/backtesting", but some names and dependencies still smell like an older trading-bot/backtest identity. Some dependencies may be legitimate, but the boundary is not as clean as the docs.

Future consequence:

- Users may misunderstand the product as an execution/backtesting system.
- Unused dependencies increase attack surface and maintenance burden.
- New contributors may extend the wrong mental model.

Better approach:

- Remove or isolate unused execution/backtesting dependencies.
- Keep compatibility names only at the boundary; move new code toward research/journal terminology.
- Make "no autonomous trading" an architectural invariant, not just documentation.

## 5. Phase-By-Phase Assessment

| Phase | Assessment | Score |
|---|---|---:|
| Phase 1 - Foundation cleanup | Mostly successful. The product direction moved away from trading-bot behavior, but legacy names like `tradingagents`, graph class naming, and some dependencies still carry old intent. | 7.0 |
| Phase 2 - Decision journal | Strong. The journal is real and useful. Weak point is best-effort persistence instead of hard trust guarantees. | 8.0 |
| Phase 3 - Signal provenance | Strong structure and source/freshness metadata. Weak point is hard-coded freshness threshold and incomplete provider timestamp guarantees. | 7.5 |
| Phase 4 - Multi-agent workspace | Coherent graph design with debate and analyst roles. Still prompt-heavy and difficult to reason about under failure. | 7.0 |
| Phase 5 - Scenario engine | Useful and product-relevant. Needs clearer guarantees around degraded scenarios and fallback outputs. | 7.0 |
| Phase 6 - Watchlists and monitoring | Good local feature set. Not yet a production scheduler/notification system. | 7.0 |
| Phase 7 - Terminal UX | Broad and useful CLI. Still has orchestration complexity and some legacy naming/aliasing. | 7.5 |
| Phase 8 - Market brief | Good memory-oriented feature. Quality depends heavily on provider reliability and summarization discipline. | 7.0 |
| Phase 9 - Historical evaluation/replay | Valuable idea, weakest trust implementation. No-lookahead must be made much stricter. | 5.5 |
| Phase 10 - Config/secrets/reliability | One of the stronger phases. Config layering, secrets, and production policy show maturity. | 8.0 |
| Phase 11 - Observability/trust | Strong surfaces, but trust is not always enforced as a blocking invariant. | 7.0 |

## 6. Architecture Quality

The architecture is above average. It has real boundaries:

- `dataflows`: provider routing, rate limiting, resilience, historical contracts.
- `signals`: deterministic signal calculation and provenance.
- `graph`: multi-agent orchestration.
- `services` and `storage`: journal persistence and domain services.
- `config`: environment/profile/policy.
- `observability`: logging, run events, provider health, LLM calls.
- `cli`: terminal UX and orchestration.

The problem is that some of these boundaries are still leaky:

- Graph orchestration still contains old and new paths.
- Provider contracts describe timestamp semantics but do not always enforce point-in-time behavior at the method parameter level.
- Journal persistence can fail without becoming a first-class result state.
- Async APIs wrap sync calls rather than modeling real asynchronous I/O.

Architectural grade: **7.5 / 10**

## 7. Code Structure And Module Organization

The codebase is modular enough to be maintainable by a small team. The split into config, dataflows, graph, services, storage, signals, and observability is sensible.

Good structure:

- `signals` is separated from LLM reasoning.
- `journal_service` centralizes persistence behavior.
- `run_orchestrator` has started extracting execution from the large graph class.
- Config and secrets are not sprinkled randomly through business code.

Bad structure:

- `research_agents_graph.py` still has too much historical baggage.
- There are duplicate orchestration concepts.
- Some state is passed as broad dictionaries, making contracts hard to verify.
- CLI orchestration monkey-patches logging behavior rather than using a clean event stream.

Maintainability grade: **6.8 / 10**

## 8. Developer Intent

The developer intent is clear:

- Build a research copilot, not a trading bot.
- Preserve reasoning artifacts.
- Use deterministic data before LLM synthesis.
- Make local-first operation work before cloud.
- Add trust infrastructure early.

That is a good product and engineering instinct.

Where intent is inconsistent:

- Some package names, dependencies, and classes still reflect the old "trading agents" framing.
- Replay/evaluation sounds like backtesting, but the implementation is not yet strict enough to support that trust claim.
- Observability is present, but not every critical failure changes user-visible state.

## 9. Scalability Assessment

### Local Scale

For one user, local research runs, CLI usage, and SQLite journaling are plausible. The current architecture can handle this.

Local scalability score: **7.0 / 10**

Main local bottlenecks:

- Provider calls can block threads.
- Rate limiting uses coarse locks/sleeps.
- Graph execution can be expensive and difficult to resume at fine granularity.
- SQLite is fine locally but needs careful transaction and backup behavior.

### Team / Cloud Scale

The Phase 1-11 architecture is not cloud-ready by itself.

Cloud scalability score: **4.5 / 10**

Reasons:

- SQLite schema and local paths are central.
- Multi-tenant identity is not a first-class Phase 1-11 invariant.
- Provider credentials, per-user rate limits, and workspace isolation need stronger boundaries.
- Long-running graph jobs need a queue/workflow runtime, not a request/CLI-style process.
- Observability needs metrics/traces, not only local structured events.

Better approach for cloud:

- Treat Phase 1-11 as the local engine.
- Put a job queue around engine execution.
- Define an engine JSON contract with idempotent run IDs.
- Move provider credentials into per-workspace secret storage.
- Use Postgres as an event/journal projection, not as an accidental port of SQLite.

## 10. Production-Readiness Assessment

| Target | Verdict |
|---|---|
| Local internal use | Ready |
| Controlled local beta | Mostly ready, with clear disclaimers |
| Hosted SaaS | Not ready |
| Financial-advice product | Not ready |
| Autonomous trading/execution | Not applicable and should remain out of scope |

Production-readiness score for local beta: **7.0 / 10**  
Production-readiness score for broad production: **4.5 / 10**

The main missing production qualities are:

- hard trust invariants;
- strict replay/no-lookahead enforcement;
- stronger secret/log redaction guarantees;
- release artifact gates;
- vulnerability scanning;
- coverage policy;
- clean migration/sync story;
- cloud job execution model.

## 11. Security Assessment

Security is better than a typical prototype but not yet production-grade.

Strengths:

- `.env` is gitignored.
- No obvious real secret was found in tracked files during spot checks.
- Config/secrets are centralized.
- Production policy rejects fake/sample providers.
- Prompt injection utilities exist for untrusted context.
- Logging redaction exists.

Risks:

- Custom CLI logs may bypass central redaction.
- Redaction appears stronger for key names than for arbitrary secret-shaped values.
- CI does not visibly run secret scanning.
- Dependency audit is not a visible CI gate.
- Prompt-injection defense exists but should be applied consistently to every external text source.

Security score: **7.0 / 10** for local use, lower for hosted deployment.

Highest-impact security fixes:

1. Add secret scanning to CI.
2. Add dependency vulnerability scanning.
3. Route all logs through one redaction pipeline.
4. Add tests for prompt-injection wrapping on every untrusted context path.
5. Separate user-controlled text from system/developer instructions at every LLM boundary.

## 12. Performance Assessment

The system is probably acceptable for local interactive research, but not optimized for high-throughput workloads.

Performance strengths:

- Provider rate limiting and retries exist.
- Expensive LLM work is bounded by graph structure and local tool-loop limits.
- SQLite is appropriate for local usage.

Performance risks:

- Provider timeout implementation can leave blocked worker threads.
- Async wrappers are thread-based, not true async I/O.
- Coarse vendor rate-limit sleeps can serialize unrelated work.
- Multi-agent graph cost grows quickly with analyst count, debate rounds, and fallback retries.
- Whole-graph retries can repeat expensive work.

Performance score: **6.5 / 10**

Better approach:

- Use native async HTTP/provider clients.
- Add per-stage timing metrics.
- Cache immutable historical market data by symbol/timeframe/as-of.
- Retry at node/tool level, not whole graph level.
- Make graph cost visible before a run starts.

## 13. Testing Quality

The test suite is a strength. The number of tests and passing gates show real discipline.

Testing score: **8.0 / 10**

What is good:

- Unit and non-unit test split exists.
- CLI/API gates pass.
- Mypy/ruff/format gates exist.
- The suite is large enough to catch many regressions.

What is missing:

- Strict replay no-lookahead tests.
- Journal critical-write failure tests that assert user-visible degraded/failed status.
- Config freshness policy override tests.
- Provider timeout/leaked-thread tests.
- Coverage thresholds.
- Security tests for redaction and prompt-injection boundaries.
- Migration/backup/restore tests.

## 14. Deployment And CI/CD Quality

CI is healthy for an engineering repo, not complete for a releasable product.

CI/CD score: **7.0 / 10**

Good:

- Lint, format, type check, compile, Python tests, and API build/test/lint are present.
- Python matrix support is a good signal.

Weak:

- Docker build is not visibly gated.
- Dependency scanning is not visibly gated.
- Secret scanning is not visibly gated.
- Coverage thresholds are not visibly enforced.
- Release versioning and artifact provenance are not clear.

Deployment quality:

- Local deployment is plausible.
- Dockerfile exists, but reproducibility is limited if installs are not lockfile/hash based.
- `docker-compose.yml` is development-grade, not production-grade.

## 15. Observability And Logging

Observability is one of the better parts of the system. The project captures provider health, LLM calls, data freshness, run events, and structured logs.

Observability score: **7.5 / 10**

Strong:

- Run event persistence exists.
- LLM call observability exists.
- Provider health and freshness checks exist.
- Logging redaction exists.

Weak:

- Observability does not always become enforcement. A degraded journal or data issue may be logged but not necessarily made impossible to miss.
- No clear metrics/tracing backend for cloud deployment.
- Replay audit event persistence has a likely schema mismatch when using blank `research_run_id`.

Better approach:

- Make every critical trust degradation part of the run result.
- Add explicit `trust_status`, `journal_status`, `data_freshness_status`, and `replay_integrity_status`.
- For cloud, emit OpenTelemetry-style traces/metrics around graph nodes, provider calls, and LLM calls.

## 16. Error Handling And Async/Concurrency

Error handling is present but uneven.

Good:

- Provider resilience exists.
- Fallback paths exist.
- Journal completion quality exists.
- Optional market data degradation is handled.

Weak:

- Some core data errors use generic exceptions instead of domain taxonomy.
- Unknown LLM errors can be retried/fallbacked too broadly.
- Provider cancellation is not strong for blocking calls.
- Journal failures are too tolerant for critical artifacts.

Concurrency risk:

The system exposes async wrappers, but much of the work remains synchronous under the hood. That is fine if documented as local convenience. It is not fine if later treated as scalable async architecture.

## 17. API Design Quality

For Phase 1-11, the most important API is the engine/CLI contract, not the NestJS API.

Strengths:

- There is an engine-style boundary for running research requests.
- The CLI is rich and product-oriented.
- Domain objects are persisted in structured form rather than only text.

Weaknesses:

- Some graph state remains dictionary-shaped.
- Public result status needs stronger trust/degradation fields.
- Error taxonomy should be part of the API contract, not just logs.

API score for Phase 1-11 engine boundary: **7.0 / 10**

## 18. Database Design Quality

SQLite design is surprisingly rich for local-first use.

Strengths:

- Many important research artifacts are persisted.
- Indexes exist for run and time-based lookups.
- Journal schema supports future review and reliability work.

Weaknesses:

- Local schema and future Prisma/Postgres schema are not obviously the same canonical model.
- Workspace/user identity is not consistently a Phase 1-11 invariant.
- JSON payload duplication can be pragmatic, but needs versioning discipline.
- Replay audit persistence appears weak.

Database score for local journal: **7.0 / 10**

Database score for future hosted product: **5.0 / 10**

## 19. Extensibility Potential

Extensibility is good in the places that matter:

- new providers;
- new signal types;
- new analyst roles;
- new scenario templates;
- new journal views;
- new reliability reports.

Extensibility risk:

- If the graph class remains large and legacy-heavy, every extension will eventually touch orchestration internals.
- If provider timestamp semantics are not made strict, adding providers increases replay risk.
- If schema versioning is not formalized, journal evolution will become painful.

Extensibility score: **7.5 / 10**

## 20. What Shows Senior-Level Thinking

These are the parts that feel senior:

- Clear research-only product boundary.
- Deterministic signals separated from LLM synthesis.
- Journal-first product architecture.
- Provenance and freshness tracking.
- Config profiles and production policy.
- Secrets centralization.
- Observability as part of the product, not an afterthought.
- Prompt injection hardening utilities.
- Scenario planning and outcome review instead of one-shot recommendations.
- Strong test discipline for an early product.

## 21. What Looks Junior Or Immature

These are the parts that do not yet meet the bar implied by the strongest architecture:

- Dead code after returns in core orchestration.
- Duplicate old/new graph execution paths.
- "Mypy passes" while important untyped bodies are unchecked.
- Trust-critical failures logged instead of always reflected in result state.
- Replay contracts that describe safety more strongly than they enforce it.
- Thread-based timeout wrappers treated as resilience.
- Static heuristic confidence presented close to product-level reliability.
- Legacy trading/backtesting naming and dependencies still leaking into product identity.

## 22. Parts That Will Become Painful At Scale

1. `ResearchAgentsGraph` and adjacent orchestration code.
2. Historical replay provider contracts.
3. Journal persistence semantics.
4. Sync provider calls hidden behind async wrappers.
5. Local SQLite to cloud/Postgres sync.
6. Static signal confidence and reliability scoring.
7. CLI-specific behavior if the API later needs identical behavior.
8. Logs and local artifacts if users start sharing debug bundles.

## 23. What Should Be Rewritten First

Do not rewrite the whole system. The highest ROI is targeted removal of trust and maintenance risks.

### Priority 1 - Historical Replay Integrity

Rewrite the replay/provider contract so strict replay cannot call any `now()`-anchored provider path.

Expected ROI:

- Highest trust improvement.
- Prevents false reliability claims.
- Makes future evaluation commercially defensible.

### Priority 2 - Journal Criticality Contract

Rewrite journal persistence behavior so critical write failure changes run outcome.

Expected ROI:

- Makes the journal reliable enough to be the product memory.
- Prevents invisible data loss.

### Priority 3 - Graph Orchestration Cleanup

Delete dead code and collapse duplicate execution paths.

Expected ROI:

- Faster future development.
- Lower regression risk.
- Clearer ownership for graph behavior.

### Priority 4 - Config-Driven Freshness Policy

Wire stale-data config into signal provenance instead of using a hard-coded 24h threshold.

Expected ROI:

- Small change, high correctness improvement.
- Prevents policy mismatch.

### Priority 5 - Provider Timeout And Retry Model

Replace per-call executor timeout with real network timeouts and bounded async/concurrency.

Expected ROI:

- Better reliability under outages.
- Less resource leakage.
- More predictable latency.

### Priority 6 - CI Release Gates

Add Docker build, dependency audit, secret scanning, coverage threshold, and migration smoke tests.

Expected ROI:

- Turns a good dev repo into a releasable repo.

## 24. Hidden Technical Risks Most Developers Would Miss

1. `HYBRID` timestamp semantics passing strict replay validation is not obviously wrong at a glance, but it weakens the core no-lookahead guarantee.
2. Funding/open-interest histories anchored to `datetime.now()` can contaminate historical evaluations even if OHLCV is point-in-time.
3. Replay audit events using blank `research_run_id` may silently fail or become unjoinable because `run_events.research_run_id` is `NOT NULL`.
4. Hard-coded freshness threshold makes config policy partly fake.
5. Per-call `ThreadPoolExecutor` timeout can leave blocked provider calls alive after timeout.
6. Broad LLM fallback can turn deterministic app bugs into expensive retries.
7. Best-effort journal persistence can bias reliability by losing failed/partial runs.
8. Static confidence scores may become product claims before they are calibrated.
9. Central redaction can be bypassed by custom local log files.
10. The future API/database product model is not automatically equivalent to the local SQLite journal.

## 25. Business Potential

Commercial/open-source potential: **8.0 / 10**

The business idea is strong if positioned correctly:

- local crypto research workstation;
- evidence-backed thesis generation;
- decision journal;
- outcome review;
- scheduled briefs;
- watchlists and alerts;
- provider-integrated but not execution-focused;
- later optional cloud sync/team workspace.

Best commercial angle:

- Sell trust, memory, and workflow.
- Do not sell "AI predicts the market".
- Do not claim backtesting validity until replay is fixed.

Open-source potential:

- Strong among technical traders/researchers if local-first and provider-extensible.
- The journal schema and signal provenance can become the differentiator.
- The repo needs clearer extension docs and stricter contracts before broad contributors can work safely.

Business risks:

- Users may over-trust LLM-generated theses.
- Replay/evaluation trust bugs can damage credibility.
- Data-provider terms, rate limits, and quality will shape user experience.
- Legal positioning must stay away from personalized financial advice unless proper controls exist.

## 26. Final Scores

| Area | Score |
|---|---:|
| Overall Phase 1-11 | 7.3 / 10 |
| Architecture quality | 7.5 / 10 |
| Code structure | 7.0 / 10 |
| Maintainability | 6.8 / 10 |
| Local scalability | 7.0 / 10 |
| Cloud scalability readiness | 4.5 / 10 |
| Local production/beta readiness | 7.0 / 10 |
| Broad production readiness | 4.5 / 10 |
| Security | 7.0 / 10 |
| Performance | 6.5 / 10 |
| Testing | 8.0 / 10 |
| CI/CD | 7.0 / 10 |
| Observability | 7.5 / 10 |
| Database design, local | 7.0 / 10 |
| Database design, hosted future | 5.0 / 10 |
| Extensibility | 7.5 / 10 |
| Commercial/open-source potential | 8.0 / 10 |
| Engineering maturity | 7.0 / 10 |

## 27. Final Verdict

LunaCrypto/LunaPerception Phase 1-11 is not a toy. It is a credible local AI research workstation with a real domain model, useful journal architecture, deterministic signal layer, multi-agent workflow, and unusually strong testing for this stage.

The brutally honest part: the codebase is ahead of most LLM app prototypes, but behind the trust bar required by its own ambitions. The riskiest issues are not UI polish or model choice. They are replay integrity, journal criticality, dead orchestration paths, config-policy mismatch, and over-broad retry/fallback behavior.

If the next engineering cycle fixes historical replay, makes journal persistence a hard trust contract, deletes graph dead code, and adds missing release/security gates, this can become a genuinely strong research product. If those are ignored and the team builds UI/cloud features on top, the project will look mature from the outside while carrying trust debt in exactly the places users will rely on most.

