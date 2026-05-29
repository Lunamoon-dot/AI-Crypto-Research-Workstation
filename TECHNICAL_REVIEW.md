# LunaPerception / LunaCrypto Technical Review

Historical snapshot: this 2026-05-12 review is superseded by
`TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md` for the current
2026-05-13 phase 1-11 assessment. Keep this file only as background context;
the test counts below are historical and should not be treated as current CI
truth.

Review date: 2026-05-12

Scope: phases 1-11 only. This review evaluates the local Python AI crypto research workstation: foundation cleanup, decision journal, signal provenance, multi-agent research workspace, scenario engine, watchlists, terminal UX, market brief, historical thesis evaluation, configuration/secrets/reliability, and observability/trust.

Explicitly out of scope: Phase 12+ product backend, hosted NestJS/API readiness, cloud deployment, multi-tenant SaaS security, paid cloud sync, team workspaces, and assisted execution. Those surfaces now include a NestJS API boundary and local Prisma/Postgres scaffolding, but they are not scored as expected deliverables for this phase 1-11 review.

Commands run:

```text
pnpm lint
pnpm build
pnpm test
pnpm typecheck
```

Observed result:

```text
TypeScript API build/lint/test: PASS, 14 contract tests
Python tests: PASS in the historical snapshot; the recorded count is stale
Ruff lint: PASS
Ruff format check: PASS
Mypy: PASS, but permissive settings leave untyped function bodies unchecked
```

## Executive Verdict

Judged only through phases 1-11, this is materially stronger than a generic prototype. The Python codebase has a coherent local-first product shape: it researches crypto markets, computes deterministic signals, runs agent debate, builds a structured thesis, persists artifacts in SQLite, exposes terminal workflows, tracks watchlists, produces briefs, evaluates saved theses, and records observability events.

The best engineering decisions are the research-only product boundary, journal-first storage, Pydantic domain models, signal provenance/freshness, explicit config/secrets work, and a broad Python test suite. Those are not cosmetic. They are the right foundation for a serious local research workstation.

The harsh part has narrowed. The previously noted provider `ContextVar` propagation issue has been fixed with `contextvars.copy_context()` around the threadpool worker and is covered by a regression test. The previously noted CCXT data-window issue is also fixed and covered by tests.

The remaining runtime concern is resource cleanup rather than caller wait: `_invoke_with_resilience()` now shuts down timed-out executor attempts with `wait=False`, and a regression test verifies the call returns before a blocking vendor finishes. Provider-native timeouts and/or a stronger kill boundary are still useful so stuck provider work is actually stopped, not merely abandoned.

So the corrected verdict is: strong local alpha/beta research engine with materially better provider-context and historical data-window correctness. For phases 1-11, the project is around 8/10. The lower score from earlier reviews was mostly because it judged phase 12+ hosted platform scaffolding or stale runtime issues that are now resolved.

## Inferred Product Purpose

The code is trying to become a local-first AI crypto research workstation for thesis discipline. The durable workflow is:

```text
market context
-> deterministic signals with provenance
-> multi-agent research/debate
-> structured trade thesis
-> user decision
-> watchlist/monitoring
-> outcome review
-> reliability learning
```

That is a credible product direction. The value is not one LLM response. The value is the paper trail: run IDs, snapshots, signal IDs, debate IDs, thesis IDs, user decisions, alerts, briefs, and outcome evaluations.

Developer intent is visible: the roadmap repeatedly rejects autonomous execution, the domain language has shifted toward research artifacts, and the current Python implementation puts journal and evidence before order placement. That is senior product judgment.

## Architecture Summary

Current phase 1-11 architecture:

```text
Typer CLI
  -> config/profile/secrets resolution
  -> ResearchService / engine runner
  -> ResearchAgentsGraph
  -> SignalEngine / quant precompute
  -> dataflows provider router
  -> LLM analysts and debate stages
  -> thesis/scenario construction
  -> JournalBridge / JournalService
  -> SQLite journal
  -> terminal views, briefs, watchlists, evaluations
```

This is a reasonable local architecture. The main design tension is that the product-level concepts are well modeled, but the graph runtime still uses a lot of mutable instance state and `dict[str, Any]` at the most important boundary.

## Major Strengths

### 1. Product boundary is right

The code and roadmap consistently frame the system as research software. There is no live order placement path in the reviewed phase 1-11 core. That keeps the risk profile sane and avoids building a fake "AI trader" before the product can even prove research quality.

Why this matters: crypto research users can tolerate advisory workflows, journaling, and watchlists. They should not be asked to trust autonomous execution from a young codebase. This boundary also improves commercial positioning: the first product can be useful without crossing into brokerage/execution complexity.

What to preserve: keep "research thesis", "watch", "review", "invalidation", and "scenario" language. Avoid "buy now", "execute", "position manager", and fake performance claims until a separate audited assisted-execution layer exists.

### 2. Domain model is substantially above prototype level

The domain package contains real product nouns:

- `ResearchRun`
- `Signal`
- `SignalProvenance`
- `MarketSnapshot`
- `SignalSnapshot`
- `AgentOpinion`
- `ResearchDebate`
- `TradeThesis`
- `Scenario`
- `Watchlist`
- `Alert`
- `MarketBrief`
- `UserDecision`
- `OutcomeReview`
- `ThesisEvaluation`

Why this is good: these entities line up with the roadmap. They make later CLI, local UI, export, sync, and analytics work possible. The project is not just passing markdown strings between agents.

Remaining weakness: the graph still drops into `dict[str, Any]` for state and parses important thesis fields from LLM text. The domain model exists, but the runtime has not fully moved to structured contracts.

Better approach: introduce a typed graph state (`TypedDict` at minimum, Pydantic for persisted state) and make agent outputs structured before thesis construction. Treat free text as explanation, not as source-of-truth fields.

### 3. Journal-first architecture is a real moat

`JournalRepository` persists runs, snapshots, signals, agent opinions, debates, theses, scenarios, watchlists, alerts, briefs, evaluations, decisions, outcomes, timeline events, provider health, LLM calls, and freshness checks.

Why this is good: a journal-backed research tool can improve with the user. A chat-only research assistant cannot. SQLite is also the right first storage choice for a local workstation.

Future payoff: if the schema stays coherent, the journal becomes the foundation for reliability analytics, calibration, exports, and optional sync later.

Limit: `JournalRepository` is now very large and mixes many entity families in one file. That is fine for an MVP, but it will become painful as reliability analytics and brief/watchlist flows grow.

Better approach: keep a common transaction/store layer, but split repositories by aggregate: `ResearchRunRepository`, `SignalRepository`, `ThesisRepository`, `WatchlistRepository`, `BriefRepository`, `EvaluationRepository`, and `ObservabilityRepository`.

### 4. Signal provenance is correctly prioritized

The signal layer has deterministic factors and converts them into domain signals with source, timestamp, freshness, confidence, evidence, and optional reliability fields. This is the right antidote to LLM hand-waving.

Why this is good: user trust depends on being able to answer "why does this signal exist?" and "how fresh is it?" The code is moving in that direction.

Weakness: factor failures are often converted into neutral/degraded results, warnings, or fallback prose. That is acceptable for optional factors, but not enough for core price/freshness dependencies.

Better approach: distinguish `missing_optional_signal`, `core_data_unavailable`, and `stale_core_data`. Core data problems should produce an explicit degraded run status or fail the run in strict mode.

### 5. Phase 10 config/secrets work is directionally solid

The project has `ConfigLoader`, `SecretsManager`, runtime environment modes, production-mode validation, fake/sample provider rejection in production, provider runtime settings, and secret redaction in structured logs.

Why this is good: config is not an afterthought. The codebase is trying to centralize how runtime behavior, providers, and credentials are resolved.

Hidden gap: some lower-level LLM/provider code still depends on ambient environment or ambient context rather than explicit injection. The design intent is stronger than the enforcement.

Better approach: make `RuntimeConfig` and `ResolvedSecrets` explicit constructor inputs to all provider/LLM clients. Lower layers should not call `os.environ` or ambient `get_config()` except at a very narrow compatibility boundary.

### 6. Phase 11 observability is useful for local debugging

The code records structured events such as provider calls, LLM calls, data freshness, thesis generation, budget summaries, run events, and health records. Secret redaction is applied in logging payloads.

Why this is good: local users and developers can inspect what happened after a run. That directly supports the "trust layer" goal.

Weakness: budgets are explicitly soft. They emit warnings/events but do not enforce cancellation, degradation, or stage skipping.

Better approach: keep soft warnings for local/dev, but add hard budget policy modes: `warn`, `degrade`, `stop_stage`, and `fail_run`. Serious users need cost/latency control, not only after-the-fact logs.

### 7. Tests are meaningfully broad

The Python suite passing 570 tests is a real strength. Coverage includes domain behavior, CLI flows, config, journal, watchlists, brief service, historical replay contracts, engine contract, exceptions, thesis structured-field degradation, provider context propagation, CCXT OHLCV date-window enforcement, and LLM fallback behavior.

Why this is good: this is far beyond a weekend LLM project.

But: the suite is still thin at the production provider boundary. It now covers the CCXT `end_date` regression, provider `ContextVar` propagation, and wall-clock timeout return behavior for stuck vendor calls.

Better approach: keep those fake-boundary tests and add provider-native timeout tests for CCXT/HTTP clients where practical.

## Major Weaknesses

### 1. Resolved: Provider runtime preserves config context

Evidence:

- `luna_workstation/dataflows/config.py` stores config in `_config_ctx`, a `ContextVar`.
- `get_config()` raises if no context is bound.
- `luna_workstation/dataflows/interface.py` uses `_invoke_with_resilience()`.
- `_invoke_with_resilience()` captures `contextvars.copy_context()` before submitting the vendor function.
- `luna_workstation/dataflows/ccxt_provider.py` calls `_get_configured_exchange()`, which calls `get_config()` inside provider code.
- `tests/test_dataflow_resilience.py` covers a vendor function that calls `get_config()` inside the resilience wrapper.

Current state: the short fix is in place, so the caller's context is available inside provider worker functions.

Residual concern: the architecture still relies on ambient config, which is less explicit than passing resolved config/client objects into provider implementations.

Better approach:

- Longer term: remove ambient config from provider implementations and pass resolved config/client objects explicitly.
- Keep the regression test that exercises `get_config()` inside `_invoke_with_resilience()`.

### 2. Resolved: Provider timeout no longer waits for stuck workers

Evidence: `_invoke_with_resilience()` uses a new `ThreadPoolExecutor` per attempt, calls `fut.result(timeout=timeout_sec)`, cancels the future on timeout, and calls `ex.shutdown(wait=False, cancel_futures=True)`.

Current state: `tests/test_dataflow_resilience.py` includes a blocking fake provider and asserts the resilience wrapper returns before the fake provider finishes.

Residual concern: Python cannot kill a running thread. The wrapper bounds caller wait, but the underlying provider work can continue in the background until the provider call returns.

Better approach:

- Prefer provider-native timeouts for CCXT/HTTP clients.
- For hard isolation, run provider calls in a cancellable async client or subprocess/job with a real kill boundary.
- Keep the wall-clock timeout regression test.

### 3. OHLCV fetching now enforces the requested window

Evidence:

- `_get_crypto_ohlcv_df(symbol, start_date, end_date)` parses both dates.
- `_fetch_ohlcv_until(exchange, symbol, since_ms, end_ms)` paginates until the end timestamp.
- The dataframe is deduplicated, sorted, and filtered to `start_dt <= timestamp <= end_dt` before CSV serialization.
- `tests/test_ccxt_provider.py` includes a fake exchange that returns candles beyond `end_date` and asserts the returned max date is capped.

Why this matters: phase 9 historical thesis evaluation and replay depend on point-in-time data. This removes the direct lookahead risk from the CCXT OHLCV implementation.

Residual risk: keep this test close to the provider implementation because exchange pagination quirks can change over time.

Better approach: retain provider-level fake-exchange tests and add one evaluation-level assertion that returned candles never exceed `evaluation_end`.

### 4. Historical evaluation is labeled correctly, but data enforcement is not complete

`EvaluationService` correctly describes itself as saved-thesis quality evaluation, not broker-accurate backtesting. That is good. The direct CCXT OHLCV lookahead bug is fixed, but the evaluation layer should still validate candle ranges as a defense-in-depth boundary.

Why problematic: relying only on provider-level correctness means a future provider change could reintroduce future candles without the evaluation layer catching it.

Future consequence: users may trust MFE/MAE, invalidation, and target-hit metrics more than they should.

Better approach: route evaluation through `route_to_vendor_historical()` with an explicit `DataWindow` and AS_OF/HYBRID contract, or inject a strict `PriceLoader` that validates the returned candle range before evaluating.

### 5. `ResearchAgentsGraph` is still a god object

Evidence: `ResearchAgentsGraph` creates LLM clients, creates tool nodes, builds the LangGraph workflow, manages budget tracking, manages journal bridge, owns mutable `GraphRunContext`, precomputes quant signals, parses thesis fields, persists artifacts, writes reports, handles checkpointing, and wraps fallback execution.

Why problematic: too many responsibilities are coupled in one runtime class. It is difficult to reason about concurrency, replay, persistence, and fallback behavior independently.

Future consequence: every future feature will touch the same central class. Regression risk will rise fast as agents, scenarios, brief memory, watchlist activation, and evaluation analytics deepen.

Better approach:

- `ResearchRunOrchestrator`: run lifecycle and status.
- `GraphFactory`: LangGraph construction only.
- `ToolRuntime`: config-bound tool/provider execution.
- `QuantPrecomputeService`: deterministic signal precompute.
- `ThesisBuilder`: structured thesis creation.
- `JournalCoordinator`: persistence and degraded/failure policy.
- `ReportWriter`: markdown/report exports.

Keep `ResearchAgentsGraph` as a compatibility facade if needed.

### 6. Thesis construction now marks structured-field degradation

Evidence: `ThesisBuilder` prefers `final_trade_summary_json` for `direction`, `confidence`, `entry_zone`, `invalidation`, and `target_zones`. If the structured payload is missing or a legacy prose fallback is used, `TradeThesisStructuredSummary.is_degraded` and `degradation_reasons` are populated.

Why this matters: entry, invalidation, targets, and direction are critical fields for UI/watchlist/alert flows. Missing structured data is no longer silently persisted as if it were complete.

Residual risk: the fallback still exists for legacy prose-only graph output, so the next hardening step is to make structured thesis JSON mandatory at the agent boundary.

Better approach: require the setup-planner/portfolio-manager stage to emit a Pydantic-compatible JSON object with fields for direction, confidence, entry zone, invalidation, target zones, supporting evidence IDs, contradicting evidence IDs, missing data, and monitor-next. Store the prose as `rationale_markdown`.

### 7. Error handling hides degraded artifacts

There are 98 broad `except Exception` occurrences in `apps/ai-service/luna_workstation`. Some are defensive and acceptable, but the pattern is overused around provider routing, signal computation, persistence bridges, and LLM fallback.

Why problematic: optional degradation is good; silent or under-signaled degradation is not. A run can look complete while missing important signals, journal rows, provider health records, or structured fields.

Future consequence: users trust a thesis that was built under partial failure. Debugging later becomes difficult because failure state is spread across logs instead of the domain artifact.

Better approach:

- Add explicit run statuses: `failed`, `completed`, `completed_degraded`.
- Make mandatory artifacts mandatory: run row, thesis row, core snapshot, and event trail.
- Allow optional providers to fail only with visible typed degradation records.
- Surface degradation in `journal workspace`, `watchlist brief`, and report exports.

### 8. Type safety is weaker than the green mypy result suggests

Evidence:

- `disallow_untyped_defs = false`.
- `check_untyped_defs = false`.
- `ignore_missing_imports = true`.
- The graph state uses `dict[str, Any]`.
- Some high-risk fields come from free-form text keys such as `final_trade_decision`.

Why problematic: mypy passing does not mean the orchestration layer is safe. The most important runtime state is largely unchecked.

Future consequence: schema drift and missing keys will show up at runtime, often after expensive LLM/provider work has already run.

Better approach:

- First enable `check_untyped_defs = true`.
- Introduce a typed `ResearchGraphState`.
- Type service boundaries and repository payload serializers.
- Ratchet `disallow_untyped_defs` module by module, starting with `domain`, `services`, `dataflows`, and `graph`.

### 9. Config/secrets design is good but not fully enforced

The config loader and secrets manager are the right direction, but ambient config remains important in the data layer. Provider code still calls `get_config()` rather than receiving a typed provider config/client.

Why problematic: ambient state makes testing and concurrency harder. It is also the root cause of the provider thread bug.

Future consequence: adding concurrent research runs, background watchlist checks, or worker processes will expose more implicit-state bugs.

Better approach: move provider creation behind explicit factories:

```text
ResolvedRuntimeConfig
  -> ProviderClientFactory
  -> CCXTMarketDataClient(config, secrets)
  -> methods that do not call get_config()
```

### 10. Observability records exist, but operational policy is still soft

The code records `run_events`, `provider_health`, `llm_calls`, and `data_freshness_checks`, which is strong for phase 11. But budget overruns only warn, provider failures often continue, and journal write failures are not always fatal.

Why problematic: observability without policy tells you what happened, but it does not protect the run from bad states.

Future consequence: expensive or low-quality runs complete instead of being stopped or clearly marked degraded.

Better approach: convert selected observability facts into control decisions. Examples:

- stale core price data -> fail strict run
- missing optional news -> completed_degraded
- token budget exceeded -> skip optional debate round
- journal core write failure -> fail audited mode

### 11. Repository organization will become painful

`JournalRepository` is over 1,600 lines and owns many unrelated aggregate families.

Why problematic: the file will become the merge-conflict and regression center of the project. Every feature touches it.

Future consequence: changing watchlists can break evaluations; changing observability can break briefs; adding indexes/migrations becomes harder to reason about.

Better approach: split by aggregate while preserving one SQLite store and migration layer. Put cross-aggregate transaction orchestration in `JournalService`, not in a mega repository.

### 12. Dependency reproducibility is incomplete

Evidence:

- Python dependencies are mostly lower bounds in `apps/ai-service/pyproject.toml`.
- `uv.lock` exists, but Docker installs with `pip install --no-cache-dir .`.
- Both `pnpm-lock.yaml` and `package-lock.json` exist at root.
- Some imported runtime dependencies are effectively transitive.

Why problematic: clean installs can drift. LLM, LangChain, Pydantic, CCXT, and Typer ecosystems change quickly.

Future consequence: a release can pass today and fail tomorrow without code changes.

Better approach:

- Use one Node package manager.
- Declare all direct imports explicitly.
- Build Docker from a lockfile or generated constraints.
- Add scheduled dependency update tests and `pip-audit`/npm audit gates.

### 13. CI is good for Python but not yet a full release gate

The active GitHub workflow runs Ruff, mypy, unit tests, and integration tests for `apps/ai-service`. That is appropriate for phase 1-11. However, CI does not yet prove Docker build reproducibility, dependency audit, secret scanning, coverage thresholds, or clean-environment install from lockfiles.

Why problematic: local tests passing is not the same as installable beta quality.

Future consequence: contributors or beta users can hit dependency/environment issues that CI never exercised.

Better approach:

- Add clean install job.
- Add Docker build job for local CLI mode.
- Add dependency audit and secret scan.
- Upload coverage and test artifacts.
- Add a provider-runtime fake integration test that runs without real secrets.

## Critical Technical Debt

### Resolved: Provider context propagation

Why: real vendor calls can fail when `ContextVar` config is read inside threadpool workers unless the context is explicitly copied.

Current state: `_invoke_with_resilience()` runs provider functions through `contextvars.copy_context().run(...)`, and the regression test covers a provider function that reads `get_config()` inside the worker.

Remaining improvement: pass config explicitly into provider clients so provider code does not depend on ambient context.

### Resolved: Bound provider timeout caller wait

Why: timeout configuration should bound the caller's wall-clock wait, not only the `Future.result()` wait.

Current state: `_invoke_with_resilience()` cancels timed-out futures, shuts down the executor with `wait=False`, and has a wall-clock regression test.

Remaining improvement: rely on provider-native timeouts wherever available, and use a cancellable async client or process/job isolation when the worker itself must be killed.

### Resolved: OHLCV `end_date` enforcement

Why: no-lookahead claims depend on data windows being enforced in implementation, not just docs/tests.

Current state: CCXT OHLCV parses both requested dates, paginates, filters returned candles, and has fake-exchange tests for lookahead candles.

Remaining work: add an evaluation-level range assertion so downstream analytics fail loudly if any provider returns candles beyond the requested window.

### P0: Stop parsing thesis source-of-truth fields from prose

Why: watchlists, invalidation alerts, and evaluation depend on structured fields.

Consequence if ignored: downstream workflows will be brittle and silently wrong.

Better approach: structured LLM output with schema validation, prose only as rationale.

### P1: Add degraded-run semantics

Why: phase 11 trust requires the system to say "completed but degraded" when evidence is missing.

Consequence if ignored: users overtrust incomplete research.

Better approach: explicit statuses and visible degradation reasons in journal/workspace/brief outputs.

### P1: Split `ResearchAgentsGraph`

Why: it has too many responsibilities.

Consequence if ignored: future phase work will compound central-class complexity.

Better approach: extract orchestrator, graph factory, tool runtime, thesis builder, journal coordinator, and report writer.

### P1: Tighten type checks where it matters

Why: current green mypy is permissive.

Consequence if ignored: schema drift stays runtime-only.

Better approach: typed graph state, `check_untyped_defs = true`, then module-by-module strictness.

### P2: Modularize journal repositories

Why: the repository file is already too large.

Consequence if ignored: maintenance and migration work slows down.

Better approach: aggregate-specific repositories under one shared store/transaction layer.

### P2: Make local release reproducible

Why: beta users need clean install behavior.

Consequence if ignored: support burden rises.

Better approach: lockfile-based install, Docker build check, dependency audit, clean-environment CI job.

## Scalability Assessment

### Local single-user scalability

Rating: acceptable.

SQLite, synchronous CLI flows, local files, and sequential graph execution are reasonable for a local research workstation. The architecture can support one serious user running research, checking watchlists, and reviewing saved theses.

Main local bottlenecks:

- LLM latency and token cost scale with analyst count/debate rounds.
- Provider calls are synchronous and wrapped in per-call executors.
- Global provider rate limiting can serialize data fetches.
- Large prompt/report context can grow quickly.
- SQLite is fine for one user but will not like high-concurrency write workloads.

Better local scaling path:

- cache provider responses with TTL/provenance
- enforce hard budgets for optional graph stages
- summarize intermediate agent outputs into typed facts
- avoid repeated CSV/DataFrame serialization loops

### Historical/replay scalability

Rating: not ready for high-trust use until OHLCV and provider contracts are enforced.

The roadmap language is good: saved-thesis evaluation first, full replay later. But the implementation must prove every data source respects the requested time window before replay is marketed as reliable.

### Hosted scalability

Out of scope for this review. Do not use hosted/API/cloud readiness to judge phase 1-11 completion.

## Production-Readiness Assessment

### Controlled local alpha/beta

Rating: usable for controlled local beta, with provider-native timeout coverage, clean install, and hosted read-surface hardening still required before broader beta.

The product is suitable for developer/local research testing because tests pass, CLI/domain/storage are coherent, and safety copy is aligned. The CCXT OHLCV lookahead issue, provider context propagation bug, and caller-wait timeout bug are fixed; install reproducibility and hosted read surfaces are the next trust blockers.

### Serious local beta

Required before calling it serious:

- provider-native timeout coverage
- evaluation-level candle range assertion added on top of provider tests
- degraded-run status visible
- strict historical evaluation validation
- clean install/Docker verification
- dependency audit

### Hosted production

Out of scope. The repo has phase 12+ scaffolding, but it should not be treated as complete or scored here.

## Security Assessment

Phase 1-11 local security posture is reasonable but incomplete.

Strengths:

- no autonomous execution path in core
- secrets manager exists
- structured log redaction exists
- production mode rejects fake/sample data providers
- prompt-injection guardrails exist around untrusted context
- config validation warns/fails for unsafe modes

Weaknesses:

### Ambient secrets/config still leak into lower layers architecturally

Problem: lower layers depend on ambient context and environment-style resolution.

Future consequence: concurrency bugs and accidental secret/config misuse become more likely as watchlist checks and workers grow.

Better approach: explicit config/secrets injection into provider and LLM clients.

### Research/advice language still needs discipline

Problem: some agent concepts still produce "trade decision" style artifacts and infer buy/sell ratings internally.

Future consequence: user-facing reports can sound more like financial advice than research support.

Better approach: keep internal enum values if needed, but user-facing copy should say thesis, stance, scenario, invalidation, and review.

### Dependency supply-chain risk

Problem: dependency reproducibility/audit is not a hard release gate yet.

Future consequence: transitive dependency changes can introduce vulnerabilities or break provider/LLM behavior.

Better approach: locked production installs, audit jobs, and explicit direct dependency declarations.

## Performance Assessment

Strengths:

- SQLite WAL/busy timeout choices are sensible for local mode.
- Signal computation is deterministic and relatively cheap compared with LLM stages.
- Budget tracking exists.
- Some provider/exchange caching exists.

Weaknesses:

### Provider runtime overhead and cancellation

Problem: creating a new executor per provider attempt is expensive, and timed-out provider work can continue in the background until the provider call returns.

Future consequence: provider stalls dominate run time.

Better approach: provider-native timeouts, async HTTP clients where practical, and a real kill boundary for provider calls that cannot be trusted to return.

### CSV/DataFrame churn

Problem: several paths render structured OHLCV to CSV and parse it again.

Future consequence: unnecessary CPU/memory overhead as historical windows and batch evaluation grow.

Better approach: keep structured `DataFrame`/records internally, render CSV only for tool/LLM compatibility boundaries.

### Soft budgets

Problem: budgets warn but do not stop expensive runs.

Future consequence: high-cost runs can continue even when value is low.

Better approach: enforce budget policies at stage boundaries.

## Testing Quality

Rating: strong for a local Python project, with remaining gaps around production-like provider and install boundaries.

What is good:

- 49 Python test files.
- 570 tests pass locally.
- Domain, CLI, config, journal, watchlist, brief, evaluation, replay contracts, and exceptions are covered.
- Ruff and mypy gates are present.

What is missing:

- strict historical evaluation test that fails if returned candles exceed `evaluation_end`
- hard structured-output requirement at the agent boundary
- clean-install/Docker release test
- coverage threshold

Highest ROI tests:

1. Provider-native timeout tests for CCXT/HTTP clients.
2. Evaluation loader receives candles beyond `evaluation_end`; evaluation must fail or mark degraded.
3. LLM trader output missing invalidation/targets at the structured-output boundary; the agent stage must reject before graph persistence.
4. Journal write failure in audited mode must fail or mark `completed_degraded`.

## CI/CD Quality

For phase 1-11 Python development, CI is directionally solid. It runs lint, formatting, mypy, unit tests, and non-unit tests.

Weaknesses:

- no Docker build gate for local CLI image
- no dependency audit gate
- no secret scan gate
- no coverage artifact/threshold
- mypy configuration is permissive
- root TypeScript build is not the central concern for phase 1-11, but if kept in repo it should not silently drift

Better approach: create a "local beta release" workflow that proves clean install, locked dependencies, lint/type/test, Docker build, audit, and secret scan.

## Deployment Quality

For phase 1-11, deployment means local install/run, not hosted service.

Current quality: acceptable for developer use, not polished beta distribution.

Problems:

- Docker image installs from unlocked Python package state.
- Docker entrypoint is CLI oriented.
- No health check is needed for pure CLI, but a release smoke command is needed.
- Environment/config validation is strong in code but not proven in a clean container job.

Better approach:

- define a local CLI release profile
- add a smoke command that validates config, DB path, journal schema, and disabled providers
- build from pinned dependencies
- document backup/restore of SQLite journal as part of release

## API Design Quality

For phase 1-11, the important API is not HTTP. It is the local domain/service/CLI contract.

Strengths:

- Typer command surface maps well to user workflows: research, journal, thesis, signals, watchlist, dashboard/config/brief/evaluate.
- The engine JSON contract exists as a good future worker boundary.
- Domain models are explicit enough to later expose stable outputs.

Weaknesses:

- read commands are not consistently machine-readable yet (`--json`/`--plain` remains roadmap work)
- graph/service boundaries still expose raw dict state
- thesis builder depends on text parsing

Better approach:

- add stable DTOs for CLI JSON output
- treat `TradeThesis`, `Signal`, `ResearchRun`, and `MarketBrief` as public local API entities
- keep raw LLM payloads as debug/internal data

## Database Design Quality

For local SQLite phase 1-11, the design is pragmatic and useful.

Strengths:

- journal is source of truth
- domain entities are persisted
- observability tables exist
- payload JSON allows schema evolution
- run/timeline history supports auditability

Weaknesses:

- repository layer is too centralized
- some constraints are application-level rather than database-level
- payload JSON can become hard to query for reliability analytics
- migration/versioning discipline needs to stay strict as schema grows

Better approach:

- split repositories by aggregate
- add targeted indexes for thesis/evaluation/brief/watchlist queries
- keep typed columns for fields used in filtering/sorting
- use payload JSON only for flexible detail, not primary query semantics
- for the next database step, use local Postgres through Prisma as the
  schema/client target and reserve raw SQL/`pg` access for migration
  verification or compatibility fallbacks

## Extensibility Potential

High, if the core contracts are tightened.

Good extension points:

- signal factor providers
- data provider registry
- domain artifacts
- journal events
- CLI workflow commands
- engine JSON request/result contract

Fragile extension points:

- agent outputs based on prose
- graph state based on dictionaries
- ambient config context
- large central repository
- broad exception fallback behavior

Best extension strategy: stabilize data/provider/thesis contracts before adding more agents or UI. More features on top of brittle contracts will compound debt.

## What Shows Senior-Level Thinking

- Refusing autonomous execution in the core product.
- Making the journal the source of truth.
- Treating signal provenance/freshness as first-class.
- Keeping historical evaluation separate from fake broker backtesting.
- Adding config/secrets/redaction instead of scattering env reads everywhere.
- Adding observability events and LLM/provider call records.
- Using deterministic signals before LLM reasoning.
- Maintaining a real Python test suite and quality gates.
- Planning Python as engine, not product backend, for later phases.

## What Looks Junior-Level Or Immature

- Legacy prose fallback for critical thesis fields still exists, though it is now marked degraded.
- Broad `except Exception` usage in important paths.
- Mutable graph object state across runs.
- Mypy passing with untyped bodies unchecked.
- Ambient config still exists in provider code, though threadpool context propagation is now covered.
- Soft budgets without enforcement policy.
- One mega repository class for nearly every journal aggregate.
- Lower-bound dependency strategy without release lock enforcement.

## What Will Become Painful At Scale

- `ResearchAgentsGraph` as a central change hotspot.
- `JournalRepository` as a 1,600+ line multi-aggregate file.
- Historical/replay credibility if evaluation does not assert provider date ranges.
- Cost/latency if debate stages grow without hard budgets.
- User trust if degraded data is hidden behind complete-looking thesis output.
- Schema drift if graph state remains untyped.
- Provider complexity if clients continue to depend on ambient config.

## Rewrite First

1. Evaluation price loading: assert returned candles do not exceed the requested evaluation window.
2. Agent thesis output: make structured thesis JSON mandatory instead of allowing legacy prose fallback.
3. Provider clients: add provider-native timeout coverage and reduce ambient config use.
4. `ResearchAgentsGraph` orchestration responsibilities: split into smaller services.
5. `JournalRepository`: split after data/runtime hardening, not before.

## Highest ROI Improvements

### 1. Fix data correctness before adding features

Impact: highest. It protects historical evaluation, replay, signal quality, and user trust.

### 2. Add visible degraded-run states

Impact: very high. It makes the trust layer real instead of just logged.

### 3. Structured thesis output

Impact: very high. It stabilizes watchlists, invalidation, monitoring, evaluation, and UI.

### 4. Tighten mypy on critical modules

Impact: high. It prevents schema drift in the most important paths.

### 5. Clean local beta release workflow

Impact: high. It turns a developer repo into something users can install with confidence.

## Commercial / Open-Source Potential

Commercial potential is real for a local crypto research workstation. The best wedge is:

```text
local crypto research cockpit
structured thesis journal
signal provenance
watchlist monitoring
outcome review
daily brief
```

That can be useful to discretionary crypto traders and semi-pro users. The open-source angle is also plausible because local-first journal ownership and transparent signals are trust-building.

What not to sell yet:

- broker-accurate backtesting
- hosted SaaS reliability
- team collaboration
- regulated investment advice
- guaranteed alpha/performance

Best near-term product move: ship a controlled local beta after the remaining data-window/evaluation and install-reproducibility checks. Market it as research workflow software with explicit disclaimers and transparent limitations.

## Final Scores

Scores below are scoped to phases 1-11 only.

| Area | Score | Notes |
|---|---:|---|
| Project purpose clarity | 8.5/10 | Research workstation direction is coherent and commercially sensible. |
| Architecture quality | 7.0/10 | Good local architecture; graph runtime still over-centralized. |
| Code structure | 6.7/10 | Strong domain/service split, but graph/repository files are too heavy. |
| Module organization | 6.8/10 | Most packages map to product concepts; runtime boundaries need tightening. |
| Developer intent | 8.5/10 | Roadmap and implementation show clear safety/workflow thinking. |
| Scalability, local | 7.1/10 | Fine for single-user workstation; provider-native timeout coverage would improve confidence. |
| Scalability, historical/replay | 4.5/10 | Concept is right, OHLCV/data-window enforcement is not enough yet. |
| Maintainability | 6.3/10 | Tests help; `Any`, broad exceptions, and central classes hurt. |
| Production readiness, local beta | 7.0/10 | Controlled beta is plausible; install/release evidence and strict evaluation checks still matter. |
| Security, local | 6.8/10 | Good secrets/redaction/no-execution posture; ambient config remains risky. |
| Performance | 5.9/10 | LLM-heavy but acceptable; provider executor overhead still needs work. |
| Testing quality | 7.6/10 | Broad Python suite with provider-context and timeout boundary coverage; still missing install/provider-native checks. |
| Deployment quality, local | 5.8/10 | Usable by developers; beta packaging/reproducibility needs work. |
| CI/CD quality | 6.2/10 | Good Python gates; missing audit/secret/Docker/release gates. |
| Observability/logging | 7.0/10 | Strong local event model; policy enforcement still soft. |
| Error handling | 5.5/10 | Typed errors exist, but broad catch/degrade behavior hides risk. |
| Config management | 7.0/10 | Strong direction; explicit injection not fully enforced. |
| API design, local CLI/domain | 6.6/10 | Good workflow shape; machine-readable stable outputs still partial. |
| Database design, local SQLite | 7.0/10 | Pragmatic and useful; repository/query design will need modularization. |
| Extensibility potential | 7.2/10 | Good if contracts are tightened before feature expansion. |
| Business potential | 7.5/10 | Strong niche if kept honest and local-first. |
| Engineering maturity, phase 1-11 | 7.0/10 | Above prototype, below polished beta. |
| Overall phase 1-11 score | 7.0/10 | Serious local research engine with two trust-critical fixes pending. |

## Final Verdict

For phases 1-11, this is not a weak or directionless codebase. It is a serious local AI crypto research workstation with a strong product thesis and several senior-level architectural choices.

The brutal truth is narrower: the project has already built enough surface area that data correctness and runtime boundaries now matter more than adding more agents or UI. The provider context bug should still be treated as a release blocker for any serious local beta; the CCXT OHLCV lookahead risk has moved from implementation blocker to regression-test coverage that must stay in place.

After those are fixed, the highest-leverage path is structured thesis output, explicit degraded-run semantics, and graph/repository decomposition. Do that, and the project can credibly become a strong open-source local research tool. Skip that and the product will look impressive in demos while quietly producing untrustworthy research artifacts.
