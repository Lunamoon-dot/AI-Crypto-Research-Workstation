# LunaCrypto AI Research Workstation - Tong Quan Du An

> Living document. Cap nhat khi kien truc, CLI, schema, hoac ranh gioi san pham thay doi.
> Lan sua cuoi: 2026-05-16. Phien ban du an: 0.3.0.

## 1. San Pham Nay La Gi

LunaCrypto la he dieu hanh quyet dinh cho crypto thesis. No gom market
context, deterministic signals, agent debate, decision journal, monitoring, va
outcome review vao mot workflow co the kiem tra lai.

Core loop:

```text
Market data
-> deterministic signals
-> multi-agent research
-> structured trade thesis
-> user decision
-> journal
-> outcome review
-> replay / reliability learning
```

Gia tri chinh la discipline va paper trail: run IDs, signal provenance, market
snapshots, agent opinions, debate records, thesis fields, scenarios, decisions,
alerts, briefs, evaluations, provider health, LLM calls, va data freshness
checks. Ranh gioi san pham nam o research artifacts va user-reviewed decisions;
order placement va account-performance claims nam ngoai core surface.

## 2. Monorepo Context

Tu repo root:

```text
apps/
  ai-service/   Python service, Typer CLI, LangGraph research engine
  api/          NestJS product API boundary
  web/          Vite/React research workstation
packages/
  database/     Prisma schema/client for product Postgres model
docs/
  backend/frontend architecture and UX docs
```

Python package name van la `luna_workstation` de giu compatibility. Public CLI command la `lunacrypto`.

## 3. Ranh Gioi Du Lieu Hien Tai

Current source of truth for the Python engine:

```text
~/.luna_workstation/cache/research_journal.sqlite
```

`TRADINGAGENTS_JOURNAL_DB` co the override path nay.

Product API / Postgres boundary:

- `packages/database/prisma/schema.prisma` la Prisma schema cho product Postgres.
- `apps/api` doc/DTO/repository layer doc du lieu cho UI tu Postgres khi `DATABASE_URL` duoc set.
- `DATABASE_ACCESS=pg` chon raw `pg` repository fallback; mac dinh la Prisma repository.
- Chua co live mirror tu SQLite sang Postgres. Can export/sync hoac worker persistence adapter neu muon API doc artifact vua tao boi Python engine.

## 4. Architecture Snapshot

```text
CLI / Engine Contract
  -> ConfigLoader + SecretsManager
  -> ResearchService / EngineRunner
  -> ResearchAgentsGraph / ResearchRunOrchestrator
  -> deterministic SignalEngine
  -> LangGraph analyst/debate/risk/scenario flow
  -> ThesisBuilder / JournalCoordinator
  -> SQLite JournalService
```

API boundary:

```text
Frontend workstation
  -> NestJS API
  -> workspace/auth checks
  -> JobsService: inline | memory | BullMQ
  -> PythonEngineClient: lunacrypto engine run --request
  -> Postgres journal repository reads/writes when DATABASE_URL is configured
```

Current web surface: `apps/web` is a Vite + React Router workstation with
Workbench, Research, Journal, Theses, Signals, Scenarios, Alerts, Watchlists,
Briefs, Operations, Settings, Performance, and Compare routes. The API workspace
contract now includes `stage_timings` so the UI can render event-derived agent
workflow status and durations.

## 5. Thu Muc Quan Trong Trong `apps/ai-service`

```text
cli/
  main.py                 Typer entrypoint
  orchestrator.py         CLI research run orchestration
  journal_cmd.py          journal/thesis lifecycle commands
  signals_cmd.py          signal snapshot/provenance commands
  watch_cmd.py            watchlist and alert commands
  brief_cmd.py            daily market brief commands
  replay_cmd.py           historical replay commands
  diff_cmd.py             thesis/run diff commands

luna_workstation/
  agents/                 analyst, researcher, manager, risk, planner agents
  config/                 config loader/schema/secrets/provider registry
  dataflows/              provider routing, CCXT/onchain/news, historical contract
  domain/                 product/domain models
  engine/                 worker JSON request/result contract
  graph/                  LangGraph assembly, run lifecycle, journal bridge
  llm_clients/            LLM provider adapters
  observability/          logging, tracing, budget tracking, redaction
  reporting/              markdown report generation
  services/               application services
  signals/                deterministic signal engine and factors
  storage/                SQLite schema, migrations, repositories
  templates/              scenario template registry

tests/                    Python test suite
scripts/                  smoke and utility scripts
migrations/               Alembic scaffold for staged DB work
```

## 6. CLI Surface

Check the live command tree with:

```bash
python -m cli.main --help
```

Current top-level groups:

```text
analyze
watchlist
dashboard
config
journal
thesis
signals
brief
diff
research
replay
engine
```

Common commands:

```bash
lunacrypto
lunacrypto research run BTC/USDT --date 2026-05-08 --yes --plain
lunacrypto journal workspace <run_id>
lunacrypto signals snapshot <run_id>
lunacrypto thesis show <thesis_id>
lunacrypto thesis decide <thesis_id> watched --notes "Waiting for confirmation"
lunacrypto watchlist brief
lunacrypto brief daily
lunacrypto replay single BTC/USDT 2026-05-08
lunacrypto engine run --request request.json
```

## 7. Pipeline

```text
ResearchRun start
-> quant signal precompute
-> analysts: market, social, news, onchain
-> bull/bear debate
-> research manager
-> setup planner
-> risk debate: aggressive, conservative, neutral
-> portfolio manager
-> scenario planner
-> thesis/scenario/report persistence
-> completion quality gate
```

Critical artifacts:

- `ResearchRun`
- `MarketSnapshot`
- `SignalSnapshot`
- `Signal`
- `ResearchDebate`
- `AgentOpinion`
- `TradeThesis`
- `Scenario`
- `UserDecision`
- `OutcomeReview`
- `RunEvent`
- `ProviderHealth`
- `LlmCall`
- `DataFreshnessCheck`
- `Watchlist`, `WatchlistItem`, `Alert`
- `MarketBrief`
- `ThesisEvaluation`
- `ReliabilitySnapshot`

## 8. Signals

Signal weights are configured in `config/default.toml`:

| Factor | Weight |
| --- | ---: |
| funding_oi | 0.20 |
| rsi_divergence | 0.12 |
| macd | 0.08 |
| volume_profile | 0.12 |
| liquidations | 0.12 |
| regime | 0.16 |
| onchain | 0.20 |

Public signal wording uses `bullish`, `bearish`, and `neutral`. `quant_bias` is aggregate evidence, not a user decision or order instruction. Spot and perp evidence lanes are represented separately.

## 9. Providers And Config

LLM providers in the provider registry:

```text
openai, google, anthropic, xai, deepseek, qwen, glm, openrouter, azure, ollama
```

Data provider credential env vars currently tracked by config:

```text
CRYPTOPANIC_API_TOKEN
COINGECKO_API_KEY
```

Provider/model keys are resolved by `SecretsManager` from prefixed env vars such as `TRADINGAGENTS_DEEPSEEK_API_KEY`, then provider-specific env vars such as `DEEPSEEK_API_KEY`, plus optional keyring support.

## 10. Quick Numbers

These are approximate codebase shape markers, not release evidence:

| Area | Current shape |
| --- | --- |
| AI agent roles | 12 main roles across analysts, researchers, managers, risk, setup planner |
| Deterministic signal factors | 7 configured factors |
| SQLite journal tables | 20 `CREATE TABLE` entries |
| Prisma product models | 21 models |
| LLM providers | 10 providers in registry |
| Scenario templates | 7 setup templates |
| Python test files | 55 files |
| Python version | 3.10+ |

For actual pass/fail evidence, use CI and `docs/release-evidence/*`; do not treat this overview as a test report.

## 11. Safety Boundary

Non-negotiable product rules:

- no autonomous live trading;
- no hidden order placement;
- no LLM prose parsed into executable orders;
- no broker-accurate PnL/backtest claims without a real simulator;
- all user-facing outputs must keep research/not-advice positioning.

Assisted execution, if ever added, belongs outside the core research engine and must require explicit manual confirmation plus immutable audit records.

## 12. Where To Read Next

- `../README.md` for service setup.
- `ROADMAP_DEV.md` for implementation phases and contributor direction.
- `ROADMAP_PRODUCTION.md` for reliability, API/cloud, and monetization direction.
- `PRODUCTION_READINESS_REVIEW.md` and `GO_LIVE_READINESS.md` for release posture.
- `../../../docs/backend-system-design.md` for API and product backend architecture.
