# LunaCrypto AI Workstation UX Architecture

Repo review date: 2026-05-12

This repo is currently shaped as a local-first crypto research workstation. The
web app is now a Vite/React workstation, and the Python AI service plus NestJS
API define the product surface it consumes.

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
| List research runs | `GET /research-runs` | Research history and recent runs |
| Read run status | `GET /research-runs/:id` | Run header/status card |
| Read run timeline | `GET /research-runs/:id/events` | Live timeline, later SSE/WebSocket |
| Read run workspace | `GET /research-runs/:id/workspace` | Composite workspace, agent workflow, snapshots, debate, thesis |
| Read evidence bundle | `GET /research-runs/:id/evidence-bundle` | Portable run evidence export surface |
| List/detail theses | `GET /theses`, `GET /theses/:id` | Thesis inbox and thesis detail |
| Decide/review thesis | `POST /theses/:id/decision`, `POST /theses/:id/review` | Decision journal and outcome review |
| List/detail signals | `GET /signals?symbol=`, `GET /signals/:id` | Signal explorer and signal detail |
| Jobs | `GET /jobs/:id`, `POST /jobs/:id/cancel` | Queue/status/cancel affordances |
| Watchlists | `GET /watchlists`, `POST /watchlists`, `GET /watchlists/:id/items`, `PATCH /watchlists/:id`, `POST /watchlists/:id/items`, `DELETE /watchlists/:id/items/:itemId` | Watchlist management |
| Daily briefs | `GET /briefs/daily`, `POST /briefs/daily` | Daily brief archive and creation |
| Operations | `GET /operations/health`, `/provider-health`, `/llm-calls`, `/data-freshness` | Trust and reliability surfaces |
| Performance | `GET /performance/outcomes`, `/analytics`, `/trend`, `/health` | Outcome/reliability analytics |
| Comparisons | `GET /comparisons/theses`, `GET /comparisons/runs` | Thesis/run diff surface |

AI-service capabilities beyond the first API boundary:

| Capability | Current Python source | Product endpoint/status |
| --- | --- | --- |
| Full journal workspace | `ThesisService.build_workspace_payload`, journal CLI | Implemented: `GET /journal/runs/:id/workspace` |
| Market/signal snapshots | `market_snapshots`, `signal_snapshots` tables | Implemented: `GET /research-runs/:id/snapshots` |
| Agent opinions and debate | `agent_opinions`, `debates` tables | Implemented: `GET /research-runs/:id/debate` |
| Scenario planner | `scenarios` table | Implemented: `GET /theses/:id/scenarios` |
| Alerts | `alerts` table, `WatchlistService` | Implemented: `GET /alerts`, `POST /alerts/:id/read` |
| Provider health | `provider_health` table | Implemented: `GET /operations/provider-health` |
| LLM cost/latency | `llm_calls` table | Implemented: `GET /operations/llm-calls` |
| Data freshness | `data_freshness_checks` table | Implemented: `GET /operations/data-freshness` |
| Evaluations | `thesis_evaluations`, `EvaluationService` | Implemented base: `GET /performance/outcomes`, `/analytics`, `/trend` |
| Reliability | `reliability_snapshots`, factor reliability | Implemented base: `GET /performance/health`; deeper calibration later |
| Config/profile health | `config` CLI and loaders | `GET /settings/config-health`, `GET /settings/profiles` |
| Diff/replay | `diff_cmd.py`, `replay_cmd.py` | `POST /compare`, `POST /replay` |

Database boundary:

- Current implementation focus stays on `apps/ai-service`, whose journal is
  still SQLite-backed.
- Local Postgres is the Prisma target for product-schema/migration work and
  NestJS API repository reads/writes. The schema/client source is
  `packages/database/prisma/schema.prisma`.
- Set `DATABASE_URL` when running API routes that need repository-backed data.
  `DATABASE_ACCESS=pg` selects the raw `pg` fallback; otherwise the API uses
  Prisma by default.
- There is no automatic live SQLite-to-Postgres mirror yet. Treat that as an
  export/migration/worker-persistence boundary.

## Route Architecture

Recommended route map:

| Route | Purpose | Initial maturity |
| --- | --- | --- |
| `/workbench` | Daily command center with briefs, active theses, watchlists, signal board, and run queue | Implemented |
| `/research/new` | Launch a research run with symbol, market type, date, analyst set, provider profile | Implemented |
| `/research/history` | Research run list/history | Implemented |
| `/research/runs/:id` | Run status, event timeline, agent workflow visualization, snapshots, debate, artifacts, and result shortcuts | Implemented |
| `/journal/runs/:id` | Full evidence workspace: snapshots, signals, debate, scenario, report, provenance | Implemented |
| `/theses` | Thesis inbox grouped by watch, accepted, rejected, needs review, degraded | Implemented |
| `/theses/:id` | Thesis detail, evidence, scenario map, decision, outcome review | Implemented |
| `/signals` and `/signals/:id` | Signal explorer/detail by symbol, type, direction, confidence, freshness | Implemented |
| `/scenarios` | Scenario monitor | Implemented |
| `/alerts` | Alert inbox and mark-read workflow | Implemented |
| `/watchlists` | Symbol/thesis/setup watchlists and alert rules | Implemented |
| `/briefs/daily` | Daily market brief list/detail | Implemented |
| `/performance` | Outcome analytics and reliability surface | Implemented base |
| `/compare` | Run/thesis comparison surface | Implemented base |
| `/operations` | Provider health, data freshness, LLM calls, budget and failure audit | Implemented base |
| `/settings` | Workspace, provider keys, model profiles, data vendors, budgets | Implemented base |

## Navigation Model

Use a persistent left sidebar:

- Workbench
- Research
- Journal
- Theses
- Signals
- Watchlists
- Briefs
- Performance
- Compare
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
- Center: workflow organization chart and evidence tabs.
- Right rail: emerging thesis summary, degradation reasons, missing core/optional data.

The workflow chart should use the API `stage_timings` contract for start time,
duration, source event count, and event-derived state. It should show selected
analyst lanes only, then the sequential manager/risk/scenario/thesis chain.

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

### 4. Performance

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

Implemented high-priority API additions:

```text
GET /research-runs/:id/workspace
GET /research-runs/:id/snapshots
GET /research-runs/:id/debate
GET /theses/:id/scenarios
GET /alerts
POST /alerts/:id/read
```

Note: the public workspace route is `GET /journal/runs/:id/workspace`; the
research-run service also exposes the same composite internally.

Medium priority:

```text
GET /operations/provider-health
GET /operations/llm-calls
GET /operations/data-freshness
GET /performance/outcomes
GET /performance/analytics
GET /performance/trend
GET /performance/health
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
