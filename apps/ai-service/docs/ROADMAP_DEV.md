# Developer roadmap

Technical implementation phases (1â€“9), refactor priorities, and engineering timelines for contributors.

**Audience:** engineers maintaining `luna_workstation/`, API worker integration, and tests.

**See also:** [Production roadmap](ROADMAP_PRODUCTION.md) Â· [Project hub](../ROADMAP.md)
Â· [Production readiness review](PRODUCTION_READINESS_REVIEW.md)

---

## Current codebase snapshot

**Last reviewed:** 2026-05-13.

This section replaces the old branch-specific narrative. Update it when architecture changes materially.

- **Product:** AI crypto **research workstation** only â€” no autonomous order placement; CCXT and vendors are used for **market data**, not execution adapters.
- **Graph:** `ResearchAgentsGraph` delegates run lifecycle through `ResearchRunOrchestrator`; the flow is analysts -> debate -> setup planner -> risk debate -> portfolio manager -> scenario planner -> completion; artifacts are persisted through `JournalBridge` / `JournalService`.
- **Removed / out of core:** execution stack for orders, the public human command-line UI, markdown memory log + post-trade reflection loop, assisted trade-plan builder (`graph/planning` style).
- **Config:** `signal_weights`, `signal_thresholds`, and `fixed_sizing` are **research / display knobs**, not live sizing engines.
- **Thesis in SQLite:** `TradeThesis` is enriched with `debate_id`, supporting/contradicting signal IDs, agent opinion IDs, entry zone, invalidation level, target zones, contradictions, consensus, and evidence counts â€” parsed from graph state after each run.
- **Engine contract:** API workers call `python -m luna_workstation.engine run --request`; human workflows live in the web/API.
- **Tests:** the service currently has 55 Python test files. Use CI or a fresh local run for pass counts; required gates are Ruff lint, Ruff format check, mypy, compile, pytest, coverage, dependency audit, secret scan, Docker build, and SQLite smoke.

Phase sections below state **intent**; partial implementations should track acceptance criteria as backlog.

---

## Excellence backlog â€” AI Crypto Research Workstation (engineering)

Criteria below push the product from **good** toward **best-in-class**. They extend phase acceptance criteria; not all are MVP-blocking.

### Reproducibility & research rigor

- Persist **model identifiers, provider, and effective config snapshot** (or hash) on each `ResearchRun` so artifacts are explainable months later.
- **Historical / replay** flows (Phase 9Câ€“9D) must enforce provider-level no-lookahead rules before marketing â€œreplayâ€ as trustworthy.
- **Golden fixtures** for signal adapters and aggregation edge cases (contradictions, missing data, stale bundles).

### Agents & LLM governance

- **Structured output** on every agent whose output feeds thesis, debate, or journal â€” free text only as annotated fallback with telemetry.
- **Refusal / insufficient data** as first-class outcomes (visible in journal), not generic filler prose.
- **Token and latency budgets** per graph stage; optional routing of lighter models for shallow subtasks when configured.

### Research workflow for active traders

- **Compare or diff** two runs or theses (same symbol, nearby dates) to see what changed in evidence and stance.
- **Research bundles**: export a portable set (run ID, snapshot IDs, thesis, hashes) for archival or peer review.

### Developer experience & ecosystem

- Machine-readable outputs (`--json`, `--plain`) on core **read** commands once UX stabilizes (Phase 7).
- Integration boundaries documented (REST/MCP/webhooks) without embedding UI concerns in `luna_workstation/` domain.

---

# Phase 1: Foundation Cleanup

Estimated time: 1-2 weeks.

## Goal

Finish the identity shift to a research workstation.

## Problems In The Current Codebase

Some modules still use old language:

- `TradingGraph`;
- pre-reset trade-intent models;
- execution-oriented configuration names;
- `backtest`;
- `position`;
- `portfolio`;
- `dashboard`.

This is not only naming debt. These names preserve the wrong architecture in the developer's mind. If the code continues to speak in trading-bot language, future features will drift back toward execution automation.

## Required Changes

Rename and isolate domain concepts:

| Current Concept | Target Concept |
|---|---|
| `TradingGraph` | `ResearchGraph` or `ResearchRunGraph` |
| pre-reset trade-intent models | `TradeThesis` or `ThesisRecommendation` |
| execution-oriented configuration | `planning_config` |
| `backtest` | `historical_evaluation` |
| `position` | `hypothetical_position` or `tracked_thesis` |
| `decision` | `thesis_decision` |
| `dashboard` | `research_workspace` |

Create a domain package:

```text
luna_workstation/domain/
  research_run.py
  signal.py
  thesis.py
  decision.py
  outcome.py
  provenance.py
  scenario.py
```

## Core Domain Models

### ResearchRun

```text
ResearchRun
- id
- symbol
- asset_class
- timeframe
- started_at
- completed_at
- market_snapshot_id
- signal_ids
- debate_id
- thesis_id
- user_decision_id
- outcome_review_id
- status
```

### Signal

```text
Signal
- id
- symbol
- signal_type
- direction
- strength
- confidence
- source
- source_timestamp
- observed_at
- expires_at
- evidence
- reliability_score
```

### TradeThesis

```text
TradeThesis
- id
- research_run_id
- symbol
- direction
- setup_type
- thesis_text
- confidence
- entry_zone
- invalidation_level
- target_zones
- risk_notes
- supporting_signal_ids
- contradicting_signal_ids
- created_at
```

### UserDecision

```text
UserDecision
- id
- thesis_id
- action
- user_notes
- decided_at
```

Allowed actions:

```text
accepted
rejected
watched
ignored
needs_more_research
```

### OutcomeReview

```text
OutcomeReview
- id
- thesis_id
- reviewed_at
- result
- max_favorable_excursion
- max_adverse_excursion
- invalidated
- lessons
```

## Acceptance Criteria

- No core model implies autonomous AI execution.
- The main graph produces a research artifact, not an order instruction.
- All execution language is either removed or clearly marked as future assisted execution.
- Tests still pass.
- README and web/API copy match the research-workstation positioning.

---

# Phase 2: Decision Journal Core

Estimated time: 2-4 weeks.

MVP implementation status: started. The project now has a local SQLite journal,
repository layer, journal service, graph integration, API/web journal surfaces, market
snapshot persistence, signal snapshot persistence, agent-debate persistence,
thesis timeline persistence, and outcome analytics/retrospective intelligence.
Remaining Phase 2 work is richer journal UX.

## Goal

Build the product's main moat: structured decision memory.

Without the journal, the app is just another AI market-analysis tool. With the journal, it becomes a trader workflow platform.

## Target Workflow

```text
Research Run
-> Market Snapshot
-> Signals
-> Agent Debate
-> Trade Thesis
-> User Decision
-> Outcome Review
-> Retrospective
```

## Storage

Start with SQLite for the local workstation.

Add:

```text
luna_workstation/storage/
  sqlite.py
  migrations/
  repositories/
    research_runs.py
    signals.py
    market_snapshots.py
    agent_opinions.py
    debates.py
    theses.py
    decisions.py
    outcomes.py
```

Tables:

```text
research_runs
market_snapshots
signals
signal_sources
agent_opinions
debates
trade_theses
user_decisions
outcome_reviews
run_events
```

## Product Surface

Human workflows should evolve through the web/API. Keep Python-side work focused
on runtime services, persisted artifacts, and the machine-only engine contract.

## Persisted Data

Each research run must persist:

- symbol;
- timeframe;
- market snapshot;
- signal snapshot;
- data source timestamps;
- agent opinions;
- contradictions;
- final thesis;
- confidence;
- user decision;
- outcome review;
- retrospective notes.

## Why This Matters

The journal creates a feedback loop:

```text
research -> decision -> market outcome -> review -> better future decisions
```

This is what traders actually need. It also creates user-specific data that can become personalization and monetization leverage later.

## Acceptance Criteria

- A user can run research and later retrieve the full run.
- A thesis can be accepted, rejected, watched, or reviewed.
- A thesis has a lifecycle.
- Markdown reports are exports, not canonical state.
- SQLite database can be backed up and migrated.

---

# Phase 3: Signal Provenance Layer

Estimated time: 2-3 weeks.

MVP implementation status: started. The existing quant signal engine is not
rewritten; its `SignalResult` and `FactorSignal` outputs are converted into
domain `Signal` records, persisted to SQLite, and linked to journal theses.
Remaining Phase 3 work is provider-specific source timestamps, richer freshness
policies, and historical reliability scoring.

## Goal

Make every signal explainable and auditable.

The user must be able to answer:

- why does this signal exist?
- where did the data come from?
- when was the data observed?
- is the data stale?
- how confident is the system?
- what evidence contradicts this signal?
- how reliable has this signal been historically?

## Signal Registry

Create:

```text
luna_workstation/signals/
  base.py
  registry.py
  technical/
  funding/
  sentiment/
  macro/
  onchain/
  news/
```

Each signal provider should implement:

```python
class SignalProvider:
    name: str
    required_config: list[str]

    async def generate(self, context: MarketContext) -> list[Signal]:
        ...
```

## Standard Signal Shape

```json
{
  "symbol": "BTC",
  "type": "funding_extreme",
  "direction": "bearish",
  "strength": 0.72,
  "confidence": 0.64,
  "source": "coinglass",
  "source_timestamp": "2026-05-08T08:00:00Z",
  "freshness_seconds": 180,
  "evidence": {
    "funding_rate": "0.084%",
    "percentile_30d": 96
  },
  "reliability": {
    "historical_hit_rate": 0.58,
    "sample_size": 241
  }
}
```

## Freshness Policy

Suggested starting rules:

| Data Type | Max Stale |
|---|---|
| price | 30-60 seconds for intraday |
| funding | provider funding interval |
| open interest | 5-15 minutes |
| news | 15-30 minutes |
| sentiment | 15-60 minutes |
| macro calendar | 24 hours |
| onchain | provider-specific |

If data is stale, the thesis must show a warning and reduce confidence.

## Acceptance Criteria

- Every signal has source, timestamp, confidence, and evidence.
- Stale data is visible to the user.
- Signal providers can fail without crashing the full research run.
- Contradicting signals are first-class, not buried in prose.

---

# Phase 4: Multi-Agent Research Workspace

Estimated time: 3-5 weeks.

## Goal

Turn the agent system into a useful research team, not prompt theater.

MVP implementation status: completed. Existing analyst reports, bull/bear
research debate, setup proposal, and risk debate are adapted into typed
`AgentOpinion` records and persisted with a `ResearchDebate` summary. Consensus
confidence is adjusted for conflict, missing data, and stale/unknown data;
contradictions are exposed with typed messages; trade theses include opinion
evidence and confidence-adjustment context; and the web/API journal surface
provides a workspace view for a full research run. Remaining post-MVP work is
native structured-output prompts for every analyst and richer web workspace UX.

## Agent Roles

Recommended initial roles:

```text
News Analyst
Sentiment Analyst
Onchain Analyst
Quant Analyst
Macro Analyst
Risk Analyst
Contrarian Analyst
Portfolio Context Analyst
```

## Structured Agent Opinion

Agents must output structured data, not arbitrary prose.

```text
AgentOpinion
- agent_name
- stance
- confidence
- key_evidence
- risks
- invalidation_conditions
- missing_data
```

Allowed stance values:

```text
bullish
bearish
neutral
uncertain
```

## Debate Aggregation

Create:

```text
luna_workstation/agents/aggregation/
  consensus.py
  contradictions.py
  confidence.py
```

Aggregator responsibilities:

- summarize stance distribution;
- detect contradictions;
- separate supporting and contradicting evidence;
- reduce confidence when conflict is high;
- reduce confidence when data is stale;
- produce final trade thesis.

## Contradiction Detection

Examples:

- bullish price structure but overheated funding;
- positive news but weak spot volume;
- BTC breakout without ETH/SOL confirmation;
- euphoric sentiment into macro risk event;
- rising open interest with price failing resistance;
- bearish macro regime while crypto signals look locally bullish.

Contradictions should be exposed directly:

```text
Contradictions:
- Bullish trend structure conflicts with elevated perp funding.
- Positive news sentiment conflicts with weak spot volume.
- Long thesis invalid if BTC loses 103,800.
```

## Acceptance Criteria

- Each agent returns a typed `AgentOpinion`.
- Aggregator produces consensus and conflict level.
- Thesis includes support and contradiction sections.
- Missing data is explicitly represented.
- No downstream logic depends on parsing free-form prose.

---

# Phase 5: Scenario Engine

Estimated time: 3-4 weeks.

## Goal

Shift AI behavior from prediction to scenario planning.

Good trading research should not say:

```text
BUY BTC NOW
```

It should say:

```text
If BTC reclaims 110k with spot volume expansion, bullish continuation becomes more likely.
If funding overheats while price stalls, long-squeeze risk increases.
```

## Scenario Model

```text
Scenario
- id
- thesis_id
- condition
- expected_market_behavior
- probability_band
- invalidation
- risk_map
- suggested_user_action
```

## Scenario Templates

Create templates for common setups:

```text
breakout
range_reversion
funding_squeeze
news_event
macro_event
trend_pullback
liquidity_sweep
```

Example required fields for `breakout`:

```text
resistance_level
volume_confirmation
funding_state
invalidation_level
higher_timeframe_trend
```

## Acceptance Criteria

- A thesis can include multiple scenarios.
- Each scenario has condition, invalidation, and risk map.
- Scenario generation is template-guided, not unconstrained LLM prose.
- User can monitor scenario activation later.

---

# Phase 6: Scenario And Alert Monitoring

Status: revised. The old Watchlist scope was decommissioned after the product
direction moved toward thesis/scenario/signal-first monitoring.

## Goal

Make the product useful every day without maintaining a separate watchlist
domain.

## Active Scope

- Scenario monitor rows surface conditional branch changes.
- Thesis status, invalidation, and review state stay on thesis artifacts.
- Signals remain inspectable as deterministic evidence.
- Alerts are stored and read as a lightweight inbox, independent of Watchlist
  tables or commands.
- Workbench attention aggregates alerts, theses, scenarios, runs, and provider
  state.

## Removed Scope

- `Watchlist`, `WatchlistItem`, and WatchlistService.
- Watchlist command-line workflows.
- `/watchlists` API routes.
- Watchlist-backed alert scheduler.

## Alert Language

Alerts must not command trades.

Bad:

```text
BUY BTC NOW
```

Good:

```text
BTC thesis update:
- Price reclaimed 110k.
- Funding is now elevated.
- Bullish scenario is active, but squeeze risk increased.
- Review thesis #42.
```

## Acceptance Criteria

- Scenario changes can appear in the monitor/workbench flow.
- Thesis invalidation and review state remain visible without a watchlist item.
- Signal changes can be inspected through signal surfaces.
- Alerts are stored in the journal and can be marked read.

---

# Phase 7: Retired Terminal Scope

Status: decommissioned.

The terminal-first product direction has been retired. Do not add new human
commands, Typer groups, Rich terminal screens, or command taxonomy aliases. Human
research, journal, thesis, signal, scenario, alert, and evaluation workflows live
in the web/API surface.

Keep only the machine-oriented engine contract for API workers:

```bash
python -m luna_workstation.engine run --request request.json
python -m luna_workstation.engine evaluate --request evaluation-request.json
python -m luna_workstation.engine schema
```

Acceptance criteria for future work in this area:

- Runtime services remain callable from API workers without a public console script.
- Docs and tests do not introduce retired command-line product flows.
- Web/API contracts, not terminal commands, define user-facing behavior.

---
# Phase 8: Retired Daily Brief Scope

Status: decommissioned.

Daily Brief and MarketBrief persistence/API/UI surfaces are no longer part of
the active product direction. Do not build new Brief commands, `/briefs/daily`,
or `MarketBrief` functionality from this roadmap. Daily review
should be composed from current thesis, scenario, signal, alert, run, and
provider-state artifacts.

---

# Phase 9: Historical Thesis Evaluation

Estimated time: 3-6 weeks.

## Goal

Evaluate thesis quality without pretending to run a broker-accurate backtest.

MVP implementation status: started. The core local evaluator now scores saved
journal theses over a forward OHLCV window and persists `ThesisEvaluation` records. This
MVP deliberately evaluates theses that already exist in the journal; it does not
yet replay full historical research or enforce provider-level no-lookahead
contracts.

## Phase 9 Build Stages

### 9A: Saved Thesis Outcome Evaluation

Core build:

```text
Saved TradeThesis
-> forward OHLCV window
-> target / invalidation detection
-> MFE / MAE
-> time to target / invalidation
-> persisted ThesisEvaluation
```

This is the safest first step because the thesis already existed before the
evaluation window. It evaluates thesis quality without rerunning agents or
pretending to simulate broker execution.

### 9B: Evaluation Analytics

Aggregate stored `ThesisEvaluation` records by:

- symbol;
- setup type;
- signal mix;
- agent consensus/conflict;
- confidence bucket;
- market regime.

This turns isolated outcomes into reliability intelligence.

### 9C: Historical Data Contracts

This is where Phase 9 becomes hard. Each data provider must explicitly declare:

- whether historical data is supported;
- the maximum lookback;
- source timestamp semantics;
- freshness rules;
- unsupported modes.

Providers that cannot prove historical correctness must be marked unsupported
for replay.

### 9D: No-Lookahead Research Replay

Only after 9C should the app rerun research for historical dates. Replay must
ensure:

- price candles stop at the replay timestamp;
- news and macro inputs are historical only;
- signal source timestamps are not after the replay timestamp;
- prompts cannot include future context;
- missing historical sources are visible, not silently substituted.

### 9E: Agent And Signal Reliability

Once replay and outcome records are trustworthy, compute:

- signal hit rate;
- agent stance calibration;
- contradiction usefulness;
- confidence calibration;
- setup quality by regime.

## Do Not Fake These Metrics

Do not show these unless a real execution simulator exists:

```text
Sharpe ratio
alpha
annualized return
broker-accurate PnL
portfolio max drawdown
```

## Use These Instead

```text
thesis hit rate
invalidation rate
average MFE
average MAE
time to target
time to invalidation
signal reliability
agent reliability
setup quality
```

## Thesis Replay

Build the ability to:

```text
Pick date/time
Run research using only data available at that time
Generate thesis
Compare future outcome
```

Guardrails:

- no lookahead data;
- source timestamps enforced;
- news must be historical to that time;
- LLM context must not include future data;
- stale or missing data must be visible.

## Acceptance Criteria

- Historical evaluation is clearly labeled as thesis evaluation.
- No lookahead bias in supported providers.
- Metrics evaluate research quality, not fake trading performance.
- Signal and agent reliability can be inspected over time.

---

# Refactor Priorities From Current Codebase

## Priority 1: Rename And Isolate Core Domain

Highest ROI.

Do first:

- create `luna_workstation/domain/`;
- introduce `ResearchRun`, `Signal`, `TradeThesis`, `UserDecision`, `OutcomeReview`;
- rename remaining bot-oriented language;
- keep execution outside the research core.

Result:

- architecture matches product direction;
- future contributors understand the real product;
- less risk of drifting back into autonomous execution.

## Priority 2: SQLite Decision Journal

Do next:

- create storage layer;
- add repositories;
- persist research runs;
- persist theses and user decisions;
- expose journal state through the API/web surface.

Result:

- product becomes stateful and useful over time;
- user has a reason to return daily;
- future cloud sync has a clean local source of truth.

## Priority 3: Signal Provenance

Do next:

- standardize `Signal`;
- add source timestamps;
- add freshness checks;
- add confidence and reliability;
- expose supporting and contradicting evidence.

Result:

- user trust improves;
- hallucination risk decreases;
- debug quality improves.

## Priority 4: Structured Agent Outputs

Do next:

- create `AgentOpinion`;
- enforce JSON/Pydantic output;
- remove any free-form parsing from critical paths;
- add contradiction detector;
- add consensus aggregator.

Result:

- outputs become testable;
- agent behavior becomes comparable over time;
- thesis generation becomes more stable.

## Priority 5: Thesis Lifecycle And Monitoring

Do next:

- surface scenario changes;
- keep thesis decisions and review state current;
- track invalidation;
- track target zones;
- review outcomes.

Result:

- workflow becomes daily-use product;
- alerting becomes monetizable later.

---

# Suggested Timeline

## Month 1: Architecture Reset Completion

Deliverables:

- domain models;
- service layer skeleton;
- SQLite journal;
- journal API/web workflows;
- remaining execution-language cleanup;
- stable tests.

Outcome:

```text
The codebase clearly becomes a research platform, not a bot.
```

## Month 2: Signal And Agent Quality

Deliverables:

- signal registry;
- provenance metadata;
- data freshness checks;
- structured agent opinions;
- contradiction detection;
- thesis schema.

Outcome:

```text
Research output becomes evidence-backed and debuggable.
```

## Month 3: Journal Workflow MVP

Deliverables:

- research run history;
- thesis timeline;
- user decision capture;
- outcome review;
- local alerts.

Outcome:

```text
The app becomes useful as a daily trader workflow.
```

## Month 4: UX

Deliverables:

- research console;
- journal browser;
- thesis detail view;
- markdown export.

Outcome:

```text
The product is ready for OSS beta.
```

## Month 5: Historical Evaluation

Deliverables:

- thesis replay;
- no-lookahead guardrails;
- signal reliability;
- agent reliability;
- setup analytics.

Outcome:

```text
The product starts learning from its own research history.
```

## Month 6: Cloud-Ready Architecture

Deliverables:

- REST API;
- auth design;
- cloud storage abstraction;
- alert delivery abstraction;
- paid/free tier boundary.

Outcome:

```text
The product can move from local OSS to paid cloud.
```


---

# Engineering maturity targets

## Testing

Required test coverage:

- domain model validation;
- signal provider behavior;
- data freshness policy;
- agent output parsing;
- contradiction detection;
- thesis generation;
- journal persistence;
- historical evaluation lookahead guardrails.

## CI/CD

Target checks:

```text
ruff or equivalent lint
type checking
unit tests
integration tests with mocked providers
migration tests
secret scanning
dependency audit
```


---

# Final Verdict

The correct direction is:

```text
Crypto-first research workstation for thesis discipline.
```

The highest-value product identity is:

```text
Obsidian/Cursor for crypto research.
```

The first serious rewrite/build sequence should be:

```text
ResearchRun domain
-> TradeThesis schema
-> SQLite decision journal
-> signal provenance
-> structured agent opinions
-> contradiction detector
-> scenario monitor
-> alert inbox
```

This path gives the project a realistic chance to become a useful product, reduce legal and technical risk, and build a monetizable workflow around structured trading research.
