# TradingAgents Roadmap

## Product North Star

TradingAgents should become an **AI Crypto Research Workstation / Trading Copilot**.

The realistic final product is:

> A research workspace for crypto traders that collects market data, generates signals, lets specialized AI agents debate, produces a structured trade thesis, tracks thesis invalidation, stores a decision journal, and reviews outcomes.

It should not be positioned as:

> An autonomous live-trading bot or AI hedge fund.

The durable moat is not automatic order placement. The moat is trader cognition, structured research, signal provenance, decision memory, thesis tracking, and explainability.

## Current Codebase State

Current branch:

```text
codex/research-workstation-reset
```

The codebase has already been reset away from dangerous autonomous execution:

- live/demo exchange routing is disabled;
- the CCXT live adapter was removed;
- auto-close monitoring was removed;
- websocket execution loops were removed;
- prose parsing is no longer used as an execution trigger;
- `bypass_blocks` style risk bypassing has been removed from the user flow;
- CLI execution UX has been rebranded toward trade planning;
- historical backtest UX has been rebranded toward historical thesis evaluation;
- paper adapter monitoring is now alert-only and does not mutate positions;
- tests pass after the reset.
- Phase 1 domain reset has started:
  - `tradingagents/domain/` now defines research-run, signal, thesis, decision, outcome, scenario, provenance, and planning models;
  - `ResearchAgentsGraph` is available as the forward-facing graph name;
  - the graph builds `ResearchRun` and `TradeThesis` artifacts internally;
  - CLI configuration now uses assisted planning terminology while preserving legacy compatibility;
  - reports label the output as `Trade Plan`, not execution.
- Phase 2 MVP has started:
  - `tradingagents/storage/` provides local SQLite schema and persistence helpers;
  - `tradingagents/services/journal_service.py` is the application boundary for journal operations;
  - research runs and trade theses are persisted to the local decision journal;
  - CLI commands `journal` and `thesis` can inspect runs/theses and record decisions/outcome reviews.
- Phase 3 MVP has started:
  - existing `SignalResult` / `FactorSignal` outputs are adapted into domain `Signal` records;
  - signal provenance, freshness, evidence, and confidence are persisted to the journal;
  - research runs store saved signal IDs;
  - trade theses link supporting and contradicting signal IDs;
  - CLI command group `signals` can inspect saved signal provenance.
- Phase 2B snapshot persistence has started:
  - market snapshots capture point-in-time price, trend, volatility, regime, source timestamp, and summary;
  - signal snapshots capture immutable signal IDs and directional/freshness counts;
  - research runs link `market_snapshot_id` and `signal_snapshot_id`;
  - journal CLI can inspect saved market and signal snapshots.
- Phase 4A MVP has started:
  - agent reports and debate outputs are adapted into structured `AgentOpinion` records;
  - research debates persist consensus stance, conflict level, contradictions, missing data, and linked opinion IDs;
  - research runs link `debate_id`;
  - trade theses link `debate_id`, `agent_opinion_ids`, consensus, and contradictions;
  - journal CLI can inspect saved debates and opinions.
- Phase 2C timeline persistence has started:
  - `run_events` now serve as the durable timeline for research runs and trade theses;
  - debate, thesis creation, user decision, and outcome review events are persisted;
  - journal/thesis CLI commands can inspect timelines.
- Phase 2D outcome analytics has started:
  - outcome reviews can be listed and filtered by thesis or symbol;
  - journal analytics compute hit rate, invalidation rate, mixed rate, average MFE, and average MAE;
  - deterministic retrospective insights summarize invalidation, sample-size, excursion, and lesson patterns;
  - journal CLI can inspect outcome reviews and retrospective intelligence.

This is the right foundation, but the codebase still needs a deeper product/domain cleanup. Many names and structures still reflect the old trading-bot identity.

## Strategic Positioning

The product should be **crypto-first**.

Recommended initial market:

- BTC;
- ETH;
- SOL;
- top liquid alts;
- spot and perpetual research;
- no autonomous futures execution.

Why crypto first:

- crypto traders are more comfortable with AI tools and local workflows;
- market trades 24/7, making brief/watchlist/alert features valuable;
- data sources such as funding, open interest, liquidation maps, sentiment, and onchain signals create a strong research surface;
- retail and semi-professional crypto users are more likely to pay for workflow tooling than traditional equity traders early on;
- crypto has clearer product differentiation than generic stock analysis.

Stocks can be supported later as a secondary asset class, but the first product should not split focus.

## Non-Negotiable Product Rules

- AI never executes trades autonomously.
- LLM prose is never parsed into executable orders.
- Every thesis must show supporting evidence, contradicting evidence, freshness, confidence, and invalidation.
- Execution, if reintroduced later, must be assisted, explicit, manually confirmed, and audited.
- Historical evaluation must not claim broker-accurate PnL unless a real execution simulator exists.
- The core product is a research workflow, not a trading automation system.

## Target End State

### Local OSS Product

```text
AI Crypto Research Workstation
- local SQLite journal
- research runs
- signal provenance
- multi-agent analysis
- structured trade theses
- thesis watchlists
- invalidation alerts
- market briefs
- markdown/report export
```

### Paid Cloud Product

```text
AI Crypto Research Cloud
- cloud sync
- hosted inference
- scheduled market briefs
- email/Telegram/Discord/mobile alerts
- advanced data providers
- longer history
- cross-device workspace
```

### Team/Pro Product

```text
Collaborative Trading Research Workspace
- shared journals
- shared watchlists
- collaborative thesis review
- analyst comments
- audit timeline
- role permissions
- team-level research memory
```

---

# Phase 1: Foundation Cleanup

Estimated time: 1-2 weeks.

## Goal

Finish the identity shift from trading bot to research workstation.

## Problems In The Current Codebase

Some modules still use old language:

- `TradingGraph`;
- `TradeIntent`;
- `execution_config`;
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
| `TradeIntent` | `TradeThesis` or `ThesisRecommendation` |
| `execution_config` | `planning_config` |
| `backtest` | `historical_evaluation` |
| `position` | `hypothetical_position` or `tracked_thesis` |
| `decision` | `thesis_decision` |
| `dashboard` | `research_workspace` |

Create a domain package:

```text
tradingagents/domain/
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
- README and CLI copy match the research-workstation positioning.

---

# Phase 2: Decision Journal Core

Estimated time: 2-4 weeks.

MVP implementation status: started. The project now has a local SQLite journal,
repository layer, journal service, graph integration, basic CLI commands, market
snapshot persistence, signal snapshot persistence, agent-debate persistence,
thesis timeline persistence, and outcome analytics/retrospective intelligence.
Remaining Phase 2 work is richer journal UX.

## Goal

Build the product's main moat: structured decision memory.

Without the journal, the app is just another AI market-analysis CLI. With the journal, it becomes a trader workflow platform.

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
tradingagents/storage/
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
watchlists
watchlist_items
alerts
run_events
```

## CLI Commands

Add or evolve commands toward:

```bash
python -m cli.main research BTC
python -m cli.main journal list
python -m cli.main journal show <run_id>
python -m cli.main thesis list
python -m cli.main thesis show <thesis_id>
python -m cli.main thesis decide <thesis_id>
python -m cli.main thesis review <thesis_id>
```

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
tradingagents/signals/
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
research debate, trader plan, and risk debate are adapted into typed
`AgentOpinion` records and persisted with a `ResearchDebate` summary. Consensus
confidence is adjusted for conflict, missing data, and stale/unknown data;
contradictions are exposed with typed messages; trade theses include opinion
evidence and confidence-adjustment context; and the journal CLI provides a
workspace view for a full research run. Remaining post-MVP work is native
structured-output prompts for every analyst and richer web/TUI workspace UX.

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
tradingagents/agents/aggregation/
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

# Phase 6: Watchlists And Thesis Monitoring

Estimated time: 3-5 weeks.

## Goal

Make the product useful every day.

## Watchlist Scope

Users should be able to watch:

- symbols;
- specific theses;
- setup types;
- invalidation levels;
- funding extremes;
- sentiment shifts;
- macro events.

## Alert Types

```text
price_level_crossed
thesis_invalidated
target_zone_reached
signal_flipped
funding_extreme
sentiment_shift
macro_event_near
volume_confirmation
contradiction_detected
scenario_activated
```

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

- User can add/remove watchlist symbols.
- User can watch a thesis.
- Thesis invalidation can trigger an alert.
- Signal changes can trigger an alert.
- Alerts are stored in the journal.

---

# Phase 7: Terminal-First Research UX

Estimated time: 4-8 weeks.

## Goal

Build a serious terminal research workspace before building a web app.

The terminal should become the product's first real UI:

```text
run research -> inspect workspace -> manage thesis lifecycle -> monitor watchlist -> review outcomes
```

This is not a generic dashboard and not an execution console. It is a local-first
research cockpit for reading evidence, preserving decisions, and reviewing thesis
quality over time.

## UX Principles

- Terminal first, web later.
- Evidence before opinion.
- IDs are always visible so the next command is obvious.
- Freshness, source, and timestamp are visible wherever data can become stale.
- Lists use tables; entities use panels; lifecycles use timelines.
- Default output is Rich and human-readable; later add `--json` and `--plain` for scripts.
- Language must say `review`, `watch`, `reassess`, or `stand aside`, never `buy now` or `sell now`.
- Read-only views must not fetch live provider data unless the command explicitly says so.

## Current CLI Surface

The current command tree should be documented and improved before adding a new UI:

```bash
tradingagents
tradingagents analyze

tradingagents journal path
tradingagents journal list
tradingagents journal show <run_id>
tradingagents journal workspace <run_id>
tradingagents journal timeline <run_id>
tradingagents journal market-snapshot <snapshot_id>
tradingagents journal signal-snapshot <snapshot_id>
tradingagents journal debate <debate_id>
tradingagents journal outcomes
tradingagents journal retrospective

tradingagents thesis list
tradingagents thesis show <thesis_id>
tradingagents thesis scenarios <thesis_id>
tradingagents thesis timeline <thesis_id>
tradingagents thesis decide <thesis_id>
tradingagents thesis review <thesis_id>

tradingagents signals list
tradingagents signals show <signal_id>

tradingagents watchlist add-symbol BTC/USDT
tradingagents watchlist add-thesis <thesis_id>
tradingagents watchlist list
tradingagents watchlist brief
tradingagents watchlist check
tradingagents watchlist alerts

tradingagents evaluate run ...
tradingagents config ...
tradingagents risk ...
```

The `dashboard` command is only a placeholder until the terminal workflows are
stable.

## Target Command Taxonomy

Do not destructively rename existing commands. In the medium term, add a
`research` namespace as aliases over the existing command groups:

```bash
tradingagents research run BTC/USDT
tradingagents research workspace <run_id>
tradingagents research brief
tradingagents research journal
tradingagents research thesis list
tradingagents research thesis show <thesis_id>
tradingagents research watchlist brief
tradingagents research signals BTC/USDT
```

The alias layer is for UX coherence only. The service layer and persistence
model should remain shared with `journal`, `thesis`, `signals`, and `watchlist`.

## Standard Terminal Workflows

### First-Run Setup

```bash
tradingagents config list
tradingagents config show <profile>
tradingagents journal path
```

The user should immediately know:

- which config profile is active;
- where the SQLite journal lives;
- which optional providers are disabled;
- whether the product is in research-only mode.

### Deep Research Workflow

```bash
tradingagents analyze
tradingagents journal list
tradingagents journal workspace <run_id>
```

The interactive run remains the default beginner flow. A later non-interactive
flow should support:

```bash
tradingagents research run BTC/USDT --date 2026-05-08 --profile default --yes
```

That command should produce the same persisted run, thesis, signals, scenarios,
debate, and timeline as the interactive flow.

### Workspace Inspection Workflow

```bash
tradingagents journal workspace <run_id>
tradingagents signals show <signal_id>
tradingagents journal debate <debate_id>
tradingagents journal timeline <run_id>
```

The workspace view is the main post-run screen. It should show:

- run status and IDs;
- market and signal snapshot IDs;
- consensus, confidence, and conflict;
- supporting and contradicting evidence;
- thesis summary, invalidation, target zones;
- scenarios and timeline events.

### Thesis Lifecycle Workflow

```bash
tradingagents thesis list
tradingagents thesis show <thesis_id>
tradingagents thesis scenarios <thesis_id>
tradingagents thesis decide <thesis_id>
tradingagents thesis timeline <thesis_id>
tradingagents thesis review <thesis_id>
```

The thesis detail screen should make the next action obvious:

```text
Thesis: thesis_abc123
Symbol: BTC/USDT
Direction: watch
Confidence: 64%
Setup: breakout_confirmation

Evidence:
- Support: trend signal, market analyst, volume context
- Contradiction: funding elevated, sentiment crowded

Invalidation:
- Lose 103800

Next useful commands:
- tradingagents thesis decide thesis_abc123
- tradingagents watchlist add-thesis thesis_abc123
- tradingagents thesis review thesis_abc123
```

### Daily Monitoring Workflow

```bash
tradingagents watchlist brief
tradingagents watchlist check
tradingagents watchlist alerts
```

`watchlist brief` is the daily home screen. It should summarize:

- active watched theses;
- symbol-only watches;
- recent alerts;
- saved scenarios;
- scenario activation history;
- latest persisted market snapshot when available.

`watchlist check` is an explicit one-shot monitoring command. It may create
alerts. `watchlist brief` should remain read-only by default.

### Retrospective Workflow

```bash
tradingagents journal outcomes
tradingagents journal retrospective
```

The retrospective view should answer:

- which theses worked;
- which invalidated early;
- whether MFE/MAE patterns are improving;
- which lessons should inform future research.

### Historical Thesis Evaluation Workflow

```bash
tradingagents evaluate run ...
```

This is historical thesis evaluation, not broker-accurate backtesting. Do not
show fake PnL, Sharpe, or execution metrics unless a real simulator exists.

## Terminal Screen Templates

### Research Run Completion

```text
Research Run Complete

Run ID: run_abc123
Symbol: BTC/USDT
Status: completed
Market Snapshot: market_snapshot_123
Signal Snapshot: signal_snapshot_456
Debate: debate_789
Thesis: thesis_def456

Consensus: mild_bullish
Conflict: high
Freshness: ok

Next:
- tradingagents journal workspace run_abc123
- tradingagents thesis show thesis_def456
- tradingagents watchlist add-thesis thesis_def456
```

### Journal Workspace

```text
BTC/USDT Research Workspace

Regime: Bullish but crowded
Consensus: Mild bullish
Conflict: High
Freshness: OK

Supporting:
- Higher-timeframe trend intact
- Spot volume improving

Contradicting:
- Funding elevated
- Sentiment crowded

Thesis:
Watch for reclaim of 110k. Avoid chasing if funding expands further.

Invalidation:
103.8k

Scenarios:
- If reclaim holds with volume, continuation becomes more likely.
- If funding rises while price stalls, squeeze risk increases.
```

### Watchlist Brief

```text
Watchlist Brief

Active Theses:
- BTC/USDT thesis_def456 | watch | confidence 64%
- ETH/USDT thesis_aaa111 | short | confidence 58%

Recent Alerts:
- BTC scenario activated: price reclaimed 110k. Review thesis_def456.
- ETH invalidation level reached. Review thesis_aaa111.

Symbol-only Watches:
- SOL/USDT | no thesis-backed monitoring rule yet
```

### Thesis Timeline

```text
Created
-> User marked as watch
-> Scenario activated
-> Signal conflict increased
-> Target reached or invalidation hit
-> Outcome reviewed
```

### Outcome Retrospective

```text
Outcome Retrospective

Sample Size: 24
Hit Rate: 46%
Invalidation Rate: 29%
Average MFE: 8.2%
Average MAE: -3.6%

Lessons:
- Long theses perform worse when funding is already crowded.
- Waiting for volume confirmation reduced adverse excursion.
```

## Build Order

1. Normalize CLI copy and help text toward crypto research workstation language.
2. Make `journal workspace` and `watchlist brief` the two primary terminal home screens.
3. Add non-interactive research run flags after the interactive flow is stable.
4. Add `--json` and `--plain` output modes for core read commands.
5. Add optional `research` namespace aliases without removing existing commands.
6. Revisit TUI/local web app only after the terminal workflows are excellent.

## Medium-Term UX: Local Web App

Recommended views:

```text
Research Console
Decision Journal
Thesis Timeline
Signal Explorer
Watchlists
Market Brief
Settings
```

The UX should feel closer to:

- Obsidian for journal/thesis memory;
- Cursor for research workspace;
- Bloomberg-lite for market context.

It should not feel like a marketing landing page or generic analytics dashboard.

## Acceptance Criteria

- A new user can complete setup, research, journal inspection, thesis decision, watchlist monitoring, and outcome review from the terminal.
- `journal workspace` shows the whole research artifact without opening generated report files.
- `watchlist brief` gives a useful daily view without mutating state.
- `watchlist check` is explicit when it can create alerts.
- Every screen shows IDs needed for likely next commands.
- Freshness/source timestamps are visible when showing snapshots, signals, or scenario evaluation from persisted data.
- Contradictions and missing data are visually obvious.
- CLI copy does not imply autonomous trading or trade execution.
- Historical evaluation is labeled as thesis evaluation, not broker backtesting.

---

# Phase 8: Morning Brief And Market Brief

Estimated time: 2-4 weeks.

## Goal

Create a high-value daily workflow that can become a paid feature.

The terminal version should build on Phase 7 instead of inventing a separate
surface. `watchlist brief` is the local daily home screen; the later market brief
should extend it with market-wide context, active thesis updates, and prior-brief
memory.

## Daily Brief Contents

```text
Market regime
BTC/ETH/SOL key levels
Funding extremes
Open interest changes
News drivers
Macro calendar
Sentiment shifts
Watchlist changes
Active thesis updates
Top setups
Top risks
```

Example:

```text
Market Brief - 2026-05-08

Regime:
Risk-on but crowded perps.

BTC:
- Key resistance: 110k
- Support: 103.8k
- Funding: elevated
- Thesis status: watch confirmation

Risks:
- CPI event in 9h
- Long positioning crowded
```

## Brief Memory

The brief must remember previous briefs.

Example:

```text
Yesterday: BTC needed reclaim 110k.
Today: BTC failed reclaim and funding rose. Bullish thesis confidence reduced.
```

## Acceptance Criteria

- Brief references active theses and watchlists.
- Brief can compare today's state with previous state.
- Brief is structured and scannable.
- Brief does not generate trade commands.

---

# Phase 9: Historical Thesis Evaluation

Estimated time: 3-6 weeks.

## Goal

Evaluate thesis quality without pretending to run a broker-accurate backtest.

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

# Phase 10: Configuration, Secrets, And Reliability

Estimated time: 2-3 weeks.

## Goal

Make the local app reliable and installable by other developers/users.

## Config Structure

Add:

```text
config/
  default.toml
  local.example.toml

tradingagents/config/
  loader.py
  schema.py
```

Environment variables:

```text
OPENAI_API_KEY
FINNHUB_API_KEY
REDDIT_CLIENT_ID
COINGLASS_API_KEY
DATABASE_URL
```

## Config Rules

- fail fast if required config is missing;
- warn if optional providers are missing;
- show which providers are disabled;
- do not crash the entire research run if one provider fails;
- never silently use fake data in production mode.

## Error Types

Create explicit errors:

```text
DataProviderError
StaleDataError
LLMOutputError
ConfigurationError
StorageError
RateLimitError
```

## External API Reliability

Every external data provider should have:

- timeout;
- retry with backoff;
- rate-limit handling;
- provider health status;
- graceful degradation.

## Secrets

Never log:

- API keys;
- full request headers;
- auth tokens;
- cloud sync credentials.

Add a secret redaction utility.

## Acceptance Criteria

- Fresh install has a clear config path.
- Missing optional data sources degrade gracefully.
- Logs do not leak secrets.
- Provider failures are visible and recoverable.

---

# Phase 11: Observability And Trust Layer

Estimated time: 2-4 weeks.

## Goal

Make the system explain itself.

## Run Trace

Each research run should store events:

```text
fetch_price_data: success, 320ms
fetch_funding: stale, 2h old
run_quant_agent: success, 4.2s
run_news_agent: failed, provider timeout
aggregate_thesis: success
```

Tables:

```text
run_events
provider_health
llm_calls
data_freshness_checks
```

## Explainability Questions

Every thesis must answer:

```text
Why this thesis?
What evidence supports it?
What evidence contradicts it?
What data is stale?
What would invalidate it?
What should the user monitor next?
```

## Structured Logging

Use structured logs:

```json
{
  "event": "signal_generated",
  "symbol": "BTC",
  "signal_type": "funding_extreme",
  "confidence": 0.71,
  "run_id": "..."
}
```

## Acceptance Criteria

- Research runs are debuggable after completion.
- Provider health is visible.
- LLM failures are visible.
- Thesis confidence can be explained.

---

# Phase 12: Service Layer And API

Estimated time: 3-5 weeks.

## Goal

Prepare the codebase for web app and cloud without coupling UI to internal graph/provider logic.

## Service Layer

Create:

```text
tradingagents/services/
  research_service.py
  journal_service.py
  thesis_service.py
  watchlist_service.py
  brief_service.py
  signal_service.py
```

CLI, TUI, web, and future API should call this service layer.

The CLI should not directly call graph internals, providers, or repositories in scattered ways.

## REST API

Later, add:

```text
api/
  main.py
  routes/
    research.py
    journal.py
    thesis.py
    signals.py
    watchlists.py
    briefs.py
```

Target endpoints:

```http
POST /research-runs
GET /research-runs/{id}
GET /theses
GET /theses/{id}
POST /theses/{id}/decision
POST /theses/{id}/review
GET /signals?symbol=BTC
GET /briefs/daily
```

## API Rules

- no core endpoint named `/execute`;
- no endpoint places live orders in the core product;
- assisted execution later must require explicit user approval;
- all returned theses include evidence, contradictions, freshness, and invalidation.

## Acceptance Criteria

- CLI and future web can share business logic.
- API shape reflects research workflow.
- Core domain remains independent from UI.

---

# Phase 13: Optional Assisted Execution

Estimated time: post-MVP only.

## Goal

Add execution only as an assistant layer, not as the product core.

Correct flow:

```text
AI Research
-> Trade Thesis
-> User Approval
-> Execution Ticket
-> Manual Confirmation
-> Broker/Exchange Adapter
```

## ExecutionTicket

```text
ExecutionTicket
- thesis_id
- proposed_order
- risk_summary
- user_confirmed_at
- submitted_at
- broker_response
- audit_status
```

## Hard Rules

- manual confirmation is mandatory;
- no hidden bypass;
- no auto sizing without user-defined caps;
- no leverage by default;
- no prose parsing;
- dry-run preview before submit;
- immutable audit log;
- exchange adapter is isolated from research core.

## Acceptance Criteria

- Assisted execution can be fully disabled.
- No background loop can place orders.
- Every submitted order maps to a user-confirmed ticket.
- Audit trail is complete.

---

# Phase 14: Cloud And Monetization

Estimated time: after local MVP is strong.

## Free OSS

Free local tier:

- local SQLite;
- basic agents;
- local research runs;
- decision journal;
- basic watchlists;
- manual market brief;
- paper/hypothetical planning only.

Purpose:

- user acquisition;
- developer trust;
- open-source credibility;
- local-first positioning.

## Paid Cloud

Paid tier:

- cloud sync;
- hosted inference;
- scheduled market briefs;
- alerts;
- Telegram/Discord/email delivery;
- advanced data providers;
- longer history;
- richer analytics;
- cross-device workspace.

## Team/Pro

Team tier:

- shared journals;
- shared watchlists;
- collaborative thesis review;
- comments;
- audit timeline;
- role permissions;
- team-level brief;
- analyst reliability reports.

## Acceptance Criteria

- Local product is useful before cloud exists.
- Cloud adds convenience and scale, not basic viability.
- Paid features are aligned with workflow, not hype.

---

# Refactor Priorities From Current Codebase

## Priority 1: Rename And Isolate Core Domain

Highest ROI.

Do first:

- create `tradingagents/domain/`;
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
- add journal CLI.

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

## Priority 5: Watchlist And Thesis Lifecycle

Do next:

- watch symbols;
- watch theses;
- track invalidation;
- track target zones;
- review outcomes.

Result:

- workflow becomes daily-use product;
- alerting becomes monetizable later.

---

# Things Not To Build In The Next 3 Months

Avoid:

- live execution;
- futures automation;
- leverage support;
- auto position management;
- fake backtest dashboards;
- complex portfolio optimizer;
- generic stock screener;
- cloud multi-user system before local journal is strong;
- fancy dashboard before workflow is correct;
- AI hedge fund branding.

These create technical debt, legal risk, and product confusion before the core moat exists.

---

# MVP Definition

The MVP is ready when:

```text
1. User runs research for BTC/ETH/SOL.
2. App captures market snapshot and signals.
3. Multi-agent system creates structured opinions.
4. Aggregator creates a trade thesis.
5. Thesis shows supporting and contradicting evidence.
6. User records a decision.
7. App tracks thesis invalidation and target zones.
8. User reviews the outcome.
9. App generates a daily market brief.
10. Everything is saved in the local journal.
```

The MVP does not need:

```text
live trading
mobile app
cloud sync
team collaboration
full historical replay
paid billing
broker execution
```

---

# Suggested Timeline

## Month 1: Architecture Reset Completion

Deliverables:

- domain models;
- service layer skeleton;
- SQLite journal;
- journal CLI commands;
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
- thesis watch mode;
- local alerts.

Outcome:

```text
The app becomes useful as a daily trader workflow.
```

## Month 4: Brief And UX

Deliverables:

- morning brief;
- watchlist summaries;
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

# Engineering Maturity Targets

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

## Production Readiness

Before cloud:

- structured logging;
- config schema;
- migrations;
- provider timeouts;
- retry/backoff;
- error taxonomy;
- secret redaction;
- API auth;
- rate limiting;
- audit trail.

---

# Final Verdict

The correct direction is:

```text
Crypto-first research workstation, not autonomous trading automation.
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
-> thesis watchlist
-> market brief
```

This path gives the project a realistic chance to become a useful product, reduce legal and technical risk, and build a monetizable workflow around structured trading research.
