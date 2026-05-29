# LunaCrypto Workflow

This project is a crypto research workstation. The product produces research
artifacts for manual review: signals, debates, setup proposals, theses,
scenarios, journal events, and outcome reviews.

## Data Flow

```mermaid
flowchart LR
    Web["Web/API request"] --> API["NestJS API"]
    API --> Engine["Python engine request"]
    Engine --> Config["Config + workspace context"]
    Config --> Vendors["Data vendors: CCXT, CoinGecko, CryptoPanic"]
    Vendors --> Signals["Deterministic SignalEngine"]
    Signals --> Graph["Agent graph"]
    Graph --> SQLite["AI-service SQLite journal"]
    API --> ProductDB["Product Postgres via Prisma/pg"]
    SQLite -. migration export boundary .-> ProductDB
    ProductDB --> ReadAPI["Web read APIs"]
    ReadAPI --> UI["Research UI"]
```

| Artifact | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `ResearchRun` | API/engine | journal, web | Run identity, workspace, symbol, asset class, market type, status |
| `Signal` | SignalEngine | agents, thesis builder | Deterministic factor evidence and provenance |
| `SetupProposal` | Setup Planner | risk analysts, Portfolio Manager | Spot/perp-aware setup for manual review |
| `TradeThesis` | Portfolio Manager + thesis builder | web, watchlist, evaluation | Final structured research thesis |
| `RunEvent` | engine/journal bridge | timeline UI | Audit trail for run progress, failures, and degradation |
| `ResearchRunStageTiming` | API contract mapper | workflow visualization | Event-derived stage state, timing, and source event references |

## Agent Workflow

```mermaid
flowchart TD
    Start["ResearchRun start"] --> Quant["Precompute quant signals"]
    Quant --> Analysts["Selected analyst modules in parallel: market, news, social, onchain"]
    Analysts --> Barrier["Wait for every selected analyst"]
    Barrier --> Debate["Debate agents: Bull Researcher + Contrarian Analyst"]
    Debate --> RM["Research Manager: investment_plan"]
    RM --> Setup["Setup Planner: SetupProposal"]
    Setup --> Risk["Risk debate: aggressive, conservative, neutral"]
    Risk --> PM["Portfolio Manager: final thesis decision"]
    PM --> Scenarios["Scenario Planner"]
    Scenarios --> Thesis["TradeThesis + scenarios + journal events"]
```

Only four analyst modules are user-selectable: `market`, `news`, `social`, and
`onchain`. A run may use any non-empty subset of those four lanes. If `social`
is not selected, the Sentiment/Social Analyst should not run and should not be
shown as a selected analyst lane in the run pipeline.

`Quant`, `Bull Researcher`, `Contrarian Analyst`, `Research Manager`, `Setup
Planner`, risk debaters, `Portfolio Manager`, and `Scenario Planner` are system
pipeline stages, not user-selectable analyst modules. `Contrarian Analyst` is
the bear-side debate agent; it can appear in saved opinions even when the
Social Analyst was not selected.

Pipeline status is event-driven. Analyst lanes can move to running/ready as
their own graph node lifecycle events arrive; the UI should not wait for every
agent to finish before marking completed lanes ready. Debate starts only after
every selected analyst lane has completed.

The API exposes an event-derived `stage_timings` array on research and journal
workspace responses. It normalizes quant, selected analyst lanes, debate,
research manager, setup planner, spot/perp checks, risk debate, portfolio
manager, scenario planner, and thesis stages into a stable UI contract:

```text
pending | running | completed | failed | missing
```

Each row includes start/completion timestamps, duration, and source event IDs.
The web workflow visualization uses this for timing and event traceability while
artifact presence still drives the user-facing readiness details.

The Setup Planner is the canonical business role for the old internal
`Trader` step. The legacy state key `trader_investment_plan` remains for
compatibility, but UI labels, prompts, and reports should call the role
`Setup Planner`.

## Spot Research Flow

```mermaid
flowchart TD
    Request["market_type = spot"] --> Setup["Setup Planner"]
    Setup --> SpotChecks["Spot checks: accumulation, DCA, swing entry, allocation"]
    SpotChecks --> Risk["Risk debate"]
    Risk --> Thesis["TradeThesis with spot_notes"]
```

Spot research should focus on:

- Accumulation, DCA, or swing setup logic.
- Entry zone, invalidation, target zones, and time horizon.
- Capital allocation and liquidity constraints.
- Drawdown, news, sentiment, and on-chain flow risks.
- No leverage or margin assumption.

## Perp Research Flow

```mermaid
flowchart TD
    Request["market_type = perp"] --> Setup["Setup Planner"]
    Setup --> PerpChecks["Perp checks: funding, OI, liquidation, leverage, margin"]
    PerpChecks --> Missing["Record missing_data when derivatives data is absent"]
    Missing --> Risk["Risk debate"]
    Risk --> Thesis["TradeThesis with perp_notes"]
```

Perp research should focus on:

- Funding regime, open interest, long/short crowding, and liquidation risk.
- Stop distance, leverage cap, and margin risk.
- Carry cost and squeeze risk.
- Explicit `missing_data` if funding, OI, liquidation, or heatmap context is absent.
- Manual review of leverage and margin assumptions.

## Thesis Lifecycle

```mermaid
flowchart LR
    Thesis["Saved TradeThesis"] --> Watch["Watchlist tracking"]
    Thesis --> Decision["UserDecision: watched, accepted, rejected"]
    Watch --> Alerts["Alerts: invalidation, target, scenario"]
    Decision --> Review["OutcomeReview"]
    Review --> Feedback["Performance feedback for future runs"]
```

The user remains responsible for the final decision. The system tracks what was
recommended, what the user decided, and how the thesis performed later.

## Database Boundary

Current focus is `apps/ai-service`. Its existing SQLite journal is still the
working engine source. Local Postgres is the Prisma target for product-schema
work, API repository reads/writes, and migration checks; it is not an automatic
mirror of the SQLite journal.

The canonical Prisma schema lives in
`packages/database/prisma/schema.prisma`. Prisma CLI commands default to
`postgresql://postgres:postgres@localhost:5432/lunacrypto` through
`packages/database/prisma.config.ts`. The NestJS API needs `DATABASE_URL` when
routes should read/write the product journal repository. API repository code
uses `PrismaJournalRepository` by default and can switch to the raw `pg`
fallback with `DATABASE_ACCESS=pg`.

The worker contract exists at `lunacrypto engine run --request request.json`.
Today that runner uses `JournalService` and therefore writes the configured
SQLite journal unless a future worker persistence adapter exports or writes
normalized rows into Postgres.

## Daily And Historical Flows

```mermaid
flowchart TD
    Watchlist["Watchlist"] --> Brief["Daily brief"]
    Brief --> Review["Manual review"]
    Replay["Historical replay"] --> Eval["Thesis evaluation"]
    Eval --> Reliability["Signal reliability + lessons"]
    Reliability --> FutureRuns["Future research context"]
```

Daily brief flow summarizes active symbols, saved theses, latest snapshots,
alerts, and missing data. Historical replay and evaluation are research tools,
not broker backtests: they should preserve no-lookahead boundaries and record
degradation when point-in-time data is unavailable.
