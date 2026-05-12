# LunaCrypto AI Workstation UX Architecture

Repo review date: 2026-05-12

This repo is currently shaped as a local-first crypto research workstation. The
web app is still only a placeholder, but the Python AI service and NestJS API
already define enough product surface to design a serious workstation UI.

## Product Positioning

The product should present itself as a research workstation, not a trading bot.

Core promise:

```text
Market context
-> deterministic signals
-> multi-agent research
-> structured thesis
-> user decision
-> journal
-> outcome review
```

The durable UX advantage is the paper trail: run IDs, signal provenance, agent
opinions, debate records, thesis fields, scenarios, user decisions, alerts,
briefs, evaluations, provider health, and model/cost metadata.

## Repo Capability Map

API-ready surfaces from `apps/api`:

| Capability | Current backend source | UX implication |
| --- | --- | --- |
| Start research run | `POST /research-runs` | Run launcher wizard |
| Read run status | `GET /research-runs/:id` | Run header/status card |
| Read run timeline | `GET /research-runs/:id/events` | Live timeline, later SSE/WebSocket |
| List/detail theses | `GET /theses`, `GET /theses/:id` | Thesis inbox and thesis detail |
| Decide/review thesis | `POST /theses/:id/decision`, `POST /theses/:id/review` | Decision journal and outcome review |
| List signals | `GET /signals?symbol=` | Signal explorer |
| Watchlists | `GET /watchlists`, `POST /watchlists/:id/items` | Watchlist management |
| Daily briefs | `GET /briefs/daily` | Daily brief archive |

AI-service capabilities that should be exposed next:

| Capability | Current Python source | Needed product endpoint |
| --- | --- | --- |
| Full journal workspace | `ThesisService.build_workspace_payload`, journal CLI | `GET /journal/runs/:id/workspace` |
| Market/signal snapshots | `market_snapshots`, `signal_snapshots` tables | `GET /runs/:id/snapshots` |
| Agent opinions and debate | `agent_opinions`, `debates` tables | `GET /runs/:id/debate` |
| Scenario planner | `scenarios` table | `GET /theses/:id/scenarios` |
| Alerts | `alerts` table, `WatchlistService` | `GET /alerts`, `POST /alerts/:id/read` |
| Provider health | `provider_health` table | `GET /operations/providers` |
| LLM cost/latency | `llm_calls` table | `GET /operations/llm-calls` |
| Data freshness | `data_freshness_checks` table | `GET /operations/freshness` |
| Evaluations | `thesis_evaluations`, `EvaluationService` | `GET /retrospective/evaluations` |
| Reliability | `reliability_snapshots`, factor reliability | `GET /retrospective/reliability` |
| Config/profile health | `config` CLI and loaders | `GET /settings/config-health`, `GET /settings/profiles` |
| Diff/replay | `diff_cmd.py`, `replay_cmd.py` | `POST /compare`, `POST /replay` |

## Route Architecture

Recommended route map:

| Route | Purpose | Initial maturity |
| --- | --- | --- |
| `/workbench` | Daily command center with briefs, active theses, watchlists, signal board, and run queue | API-ready composite |
| `/research/new` | Launch a research run with symbol, market type, date, analyst set, provider profile | API-ready |
| `/research/runs/:id` | Run status, event timeline, agent pipeline, and result shortcuts | API-ready base, richer data needs endpoints |
| `/journal/runs/:id` | Full evidence workspace: snapshots, signals, debate, scenario, report, provenance | Needs endpoint |
| `/theses` | Thesis inbox grouped by watch, accepted, rejected, needs review, degraded | API-ready |
| `/theses/:id` | Thesis detail, evidence, scenario map, decision, outcome review | API-ready base, scenarios/evidence needs endpoints |
| `/signals` | Signal explorer by symbol, type, direction, confidence, freshness | API-ready base |
| `/watchlists` | Symbol/thesis/setup watchlists and alert rules | API-ready base, alert endpoints needed |
| `/briefs/daily` | Daily market brief list/detail | API-ready |
| `/retrospective` | Evaluation analytics, factor reliability, agent calibration, confidence curve | Needs endpoint |
| `/operations` | Provider health, data freshness, LLM calls, budget and failure audit | Needs endpoint |
| `/settings` | Workspace, provider keys, model profiles, data vendors, budgets | Needs endpoint |

## Navigation Model

Use a persistent left sidebar:

- Workbench
- Research
- Journal
- Theses
- Signals
- Watchlists
- Briefs
- Retrospective
- Operations
- Settings

Use a top command strip:

- Symbol search: `BTC/USDT`
- Market toggle: `Spot` / `Perp`
- Date/as-of selector
- Profile selector
- Primary action: `Run research`
- Trust chips: `fresh`, `stale`, `degraded`, `missing optional data`

Use a right rail for AI assistance and contextual actions:

- Ask about this thesis
- Explain contradiction
- Summarize missing data
- Create watch
- Record decision
- Review outcome

The AI rail should be contextual, not a generic chatbot. It should reference the
current run, thesis, signals, and journal state.

## Key Screens

### 1. Workbench

Layout:

- Left sidebar for global navigation.
- Top strip with run launcher controls.
- Main column with Daily Brief, Active Thesis Inbox, Signal Heatmap, and Recent Runs.
- Right rail with Watchlist Alerts and AI command composer.

Important states:

- Degraded brief banner when snapshots are missing.
- Thesis cards must show rating, direction, confidence, invalidation, and next monitor item.
- Signals must show source and freshness, not just direction.

### 2. Research Run Workspace

Layout:

- Header: symbol, market type, status, model/profile, config hash, started/completed timestamps.
- Left timeline: run.started, snapshots_saved, signal.generated, analyst nodes, debate, thesis.generated, run.completed.
- Center: pipeline graph and evidence tabs.
- Right rail: emerging thesis summary, degradation reasons, missing core/optional data.

Tabs:

- Overview
- Signals
- Analysts
- Debate
- Risk
- Scenarios
- Raw events

### 3. Thesis Detail

Layout:

- Summary header: rating, direction, confidence, setup type, created date.
- Setup panel: entry zone, invalidation, target zones, spot/perp notes.
- Evidence panel: supporting signals, contradicting signals, stale/missing data.
- Scenario map: high/medium/low conditional branches and suggested user action.
- Decision journal: watched, accepted, rejected, skipped.
- Outcome review: hit target, invalidated, mixed, expired, unknown, lessons.

Important UX rule:

Decision and outcome review should be one click away from the thesis, because
that is how the product learns.

### 4. Retrospective

Layout:

- Overall hit rate, invalidation rate, average MFE/MAE.
- Factor reliability table by signal type.
- Agent calibration table by agent name/role.
- Confidence calibration curve.
- Recent lessons extracted from outcome reviews.

### 5. Operations

Layout:

- Provider health by component.
- LLM calls by run/stage/agent with token and latency totals.
- Data freshness checks by source.
- Run failure/degradation audit.
- Budget policy preview.

This route is important because the product is trust-heavy. Users should be able
to understand whether a thesis is weak because the market is uncertain, or
because data/provider/model quality was degraded.

## Suggested API Additions

High priority:

```text
GET /research-runs/:id/workspace
GET /research-runs/:id/snapshots
GET /research-runs/:id/debate
GET /theses/:id/scenarios
GET /alerts
POST /alerts/:id/read
```

Medium priority:

```text
GET /operations/provider-health
GET /operations/llm-calls
GET /operations/data-freshness
GET /retrospective/evaluations
GET /retrospective/reliability
GET /settings/config-health
```

Later:

```text
POST /compare/runs
POST /compare/theses
POST /replay
GET /exports/run-bundle/:id
```

## Visual Direction

The UI should feel like a professional research terminal translated to web:

- Dense but readable.
- Small cards, hard information hierarchy, 8px radius max.
- No marketing hero, no trading-game visuals, no fake PnL promise.
- Use status color sparingly: green for constructive, red for invalidation/risk, amber for stale/degraded, blue for neutral/info.
- Show provenance, freshness, and missing data near the decision surface.

