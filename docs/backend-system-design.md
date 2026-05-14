# Backend System Design

Status: current architecture plus proposed production hardening

LunaCrypto is a monorepo for a local-first crypto research product. The backend boundary is split between a NestJS product API in `apps/api`, a Python AI research engine in `apps/ai-service`, and a Prisma/Postgres schema in `packages/database`.

## Product Boundary

The backend supports research workflows, not trade execution.

Core workflow:

```text
User request
-> research run
-> market and signal snapshots
-> multi-agent debate
-> generated trade thesis
-> user decision
-> journal
-> outcome review
```

The system must preserve auditability: every thesis should be traceable back to run metadata, snapshots, signals, agent opinions, degradation reasons, and user decisions.

## Existing Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Product API | `apps/api` | HTTP boundary, workspace checks, DTO mapping, job enqueueing, Postgres journal reads/writes when `DATABASE_URL` is set |
| AI service | `apps/ai-service` | LangGraph research orchestration, signal generation, thesis generation, local SQLite journal persistence |
| Database package | `packages/database` | Prisma schema and local Postgres client generation |
| Postgres schema reference | `apps/api/src/database/postgres-schema.sql` | Compatibility/reference SQL for product API boundary |
| Docker Compose | `docker-compose.yml` | Local Postgres, Redis, API, worker, web, and optional AI/Ollama utility runtimes |

## High-Level Architecture

```mermaid
flowchart TD
  FE["Frontend workstation"]
  API["NestJS API<br/>apps/api"]
  Auth["Auth / workspace services"]
  Jobs["JobsService<br/>BullMQ / memory / inline"]
  PyClient["PythonEngineClient"]
  AI["Python AI service<br/>apps/ai-service"]
  SQLite["SQLite journal<br/>~/.tradingagents"]
  Repo["Journal repository<br/>Prisma or pg"]
  DB["Postgres<br/>product journal"]
  Redis["Redis<br/>optional queue"]

  FE --> API
  API --> Auth
  API --> Repo
  API --> Jobs
  Jobs --> Redis
  Jobs --> PyClient
  PyClient --> AI
  AI --> SQLite
  SQLite -. migration export boundary .-> DB
  Repo --> DB
```

The product API is the only frontend-facing boundary. The Python service remains the research engine and should not be called directly by the browser. Current Python runs write the configured SQLite journal; Postgres is the product API persistence model and migration target, not an automatic live mirror of SQLite.

## Runtime Modes

The current jobs layer supports three modes:

| Mode | Trigger | Behavior | Use case |
| --- | --- | --- | --- |
| Inline | `JOBS_EXECUTION_MODE=inline` | API spawns the Python engine and waits for JSON output; the Python engine writes the configured SQLite journal | Local smoke tests and simple demos |
| BullMQ | `REDIS_URL` configured | API enqueues `research.run` jobs; `apps/api/src/jobs/research-worker.ts` consumes and persists results | Production or hosted workers |
| Memory | default, or `JOBS_EXECUTION_MODE=memory` | API stores requests in memory and processes them in-process FIFO | Local development and private demos |

Production should use BullMQ with dedicated Python workers. Inline mode is useful but should not be the default for hosted traffic because research runs are long-running and provider-dependent.

## API Modules

Current NestJS module map:

| Module | Responsibility |
| --- | --- |
| `AuthModule` | Local user/workspace permission boundary |
| `UsersModule` | User lookup and defaults |
| `WorkspacesModule` | Workspace lookup and defaults |
| `DatabaseModule` | Journal repository provider |
| `JobsModule` | Research run enqueueing and Python engine bridge |
| `ResearchRunsModule` | Create/read runs, events, snapshots, debate, workspace composite |
| `JournalModule` | Journal workspace route |
| `ThesesModule` | Thesis list/detail, scenarios, decision, review |
| `SignalsModule` | Signal list/explorer |
| `WatchlistsModule` | Watchlists and watchlist items |
| `BriefsModule` | Daily market briefs |
| `AlertsModule` | Alert list and mark-read |

## Public API Surface

Existing frontend-facing routes:

| Route | Purpose |
| --- | --- |
| `POST /research-runs` | Create/enqueue a research run |
| `GET /research-runs/:id` | Fetch run summary |
| `GET /research-runs/:id/events` | Fetch run timeline events |
| `GET /research-runs/:id/snapshots` | Fetch market and signal snapshots |
| `GET /research-runs/:id/debate` | Fetch debate and agent opinions |
| `GET /research-runs/:id/workspace` | Fetch run composite workspace |
| `GET /journal/runs/:id/workspace` | Fetch journal workspace composite |
| `GET /theses` | List theses |
| `GET /theses/:id` | Fetch thesis detail |
| `GET /theses/:id/scenarios` | Fetch scenario planner output |
| `POST /theses/:id/decision` | Record user decision |
| `POST /theses/:id/review` | Record outcome review |
| `GET /signals` | List signals |
| `GET /watchlists` | List watchlists |
| `POST /watchlists/:id/items` | Add a watchlist item |
| `GET /briefs/daily` | Fetch daily briefs |
| `GET /alerts` | List alerts |
| `POST /alerts/:id/read` | Mark alert read |

Current local workspace headers:

```text
x-user-id
x-workspace-id
```

These headers should stay behind service helpers so hosted auth can replace them later without rewriting controllers.

## Request Flow: Create Research Run

```mermaid
sequenceDiagram
  participant FE as Frontend
  participant API as NestJS API
  participant Auth as AuthService
  participant Jobs as JobsService
  participant Queue as BullMQ or inline mode
  participant AI as Python engine
  participant SQLite as SQLite Journal
  participant DB as Product Postgres

  FE->>API: POST /research-runs
  API->>Auth: resolve user/workspace permission
  Auth-->>API: permission
  API->>Jobs: enqueueResearchRun(request)
  alt BullMQ
    Jobs->>Queue: add research.run
    Jobs-->>API: job id
  else Inline
    Jobs->>AI: spawn engine run
    AI->>SQLite: persist run artifacts
    AI-->>Jobs: JSON result
    Jobs-->>API: inline result
  end
  API-->>FE: run_id, status, job_id, queue_backend
```

For current inline execution, the JSON result is returned to the API, but the
full persisted run artifacts remain in the Python SQLite journal unless a
separate export/sync step writes them into Postgres.

## Request Flow: Read Thesis Workspace

```text
Frontend
-> GET /theses/:id
-> ThesesController
-> ThesesService
-> AuthService workspace permission
-> JournalRepository
-> DTO mapper in frontend-contract.ts
-> typed JSON response
```

DTO mappers in `apps/api/src/contracts/frontend-contract.ts` are the contract stabilization layer. They should remain explicit so frontend consumers do not depend directly on raw database JSON payloads.

## Data Model

Core persisted entities from `packages/database/prisma/schema.prisma`:

| Entity | Purpose |
| --- | --- |
| `User` | Product user identity row |
| `Workspace` | Product workspace boundary |
| `WorkspaceMembership` | User-to-workspace role mapping |
| `ResearchRun` | Top-level research execution metadata and links |
| `MarketSnapshot` | Captured market state for a run/symbol |
| `SignalSnapshot` | Aggregated deterministic signal snapshot |
| `Signal` | Individual deterministic signals with provenance |
| `Debate` | Multi-agent consensus and conflict metadata |
| `AgentOpinion` | Per-agent stance, role, confidence, and payload |
| `RunEvent` | Timeline events for a run |
| `TradeThesis` | Generated thesis artifact |
| `Scenario` | Conditional scenario planner output |
| `UserDecision` | User-reviewed decision for a thesis |
| `OutcomeReview` | Later thesis review and lessons |
| `Watchlist` | Workspace watchlist |
| `WatchlistItem` | Symbol/thesis/setup item under a watchlist |
| `Alert` | Workspace alert item |
| `MarketBrief` | Daily brief artifact |
| `ProviderHealth` | Provider/component health checks |
| `LlmCall` | Model/provider usage, latency, status |
| `DataFreshnessCheck` | Source freshness and threshold audit |

Important indexing pattern:

- Most user-facing tables include `workspace_id` indexes.
- Time-series-like reads sort by created/observed/captured timestamp descending.
- Run-scoped reads index by `research_run_id`.

## Repository Boundary

The API should depend on a journal repository interface, not raw persistence details. Current code already has repository implementations for Prisma and Postgres-style access.

Recommended boundary:

```text
Controller
-> Service
-> Auth/workspace guard helper
-> JournalRepository interface
-> Prisma or pg implementation
```

Rules:

- Controllers should stay thin.
- Services enforce workspace access and business rules.
- Repository implementations handle database shape differences.
- DTO mappers convert repository records into frontend contracts.

## Job and Worker Design

Production target:

```text
NestJS API
-> BullMQ queue: research-runs
-> Python worker process
-> AI graph execution
-> normalized Postgres writes
-> API reads persisted results
```

Current implementation status:

- `JobsService` can enqueue to BullMQ, store memory jobs, or run inline.
- `PythonEngineClient` can call `lunacrypto engine run --request <file>`.
- The Python engine contract currently persists through `JournalService`, which
  is SQLite-backed.
- A hosted worker still needs an explicit persistence adapter or export path
  that writes normalized artifacts into Postgres.

Job payload should include:

- `run_id`
- `workspace_id`
- `user_id`
- `symbol`
- `asset_class`
- `market_type`
- `timeframe`
- model/provider/profile config
- request timestamp

Worker requirements:

- Idempotent writes keyed by `run_id`.
- Heartbeat or event writes during long stages.
- Terminal status write for completed, degraded, failed, or cancelled.
- Clear error typing for provider failure, validation failure, timeout, and internal error.

## Consistency Model

The system is eventually consistent after `POST /research-runs`.

Expected behavior:

- API returns quickly with queued run metadata.
- Frontend polls run status/events.
- AI worker persists artifacts as stages complete.
- Thesis, snapshots, debate, and events may appear at different times.

Services should handle partial data explicitly. A missing snapshot is not always a 500; it may be a valid degraded state.

## Validation and Contracts

Current DTOs use `class-validator`. Keep validation at the HTTP boundary.

Recommended contract policy:

- All request DTOs validate required fields, enums, and bounded limits.
- All response DTOs pass through explicit mapper functions.
- Do not expose raw `payload_json` as the only source for core UI fields.
- Keep backward-compatible response fields when the frontend depends on them.
- Version breaking API changes through new fields/routes before removing old fields.

## Security and Tenancy

Current local mode uses header-provided identity. Hosted mode needs real auth.

Required hosted controls:

- Authenticated user session or JWT.
- Server-derived user ID; do not trust browser-provided `x-user-id`.
- Workspace membership and role checks on every route.
- Workspace-scoped queries for all user data.
- Secret storage outside repo and outside frontend bundles.
- Rate limiting for run creation and expensive AI operations.
- Audit log for decisions, reviews, and admin operations.

Tenancy invariant:

```text
No route may read or mutate a user-facing record without workspace authorization.
```

## Observability

The backend should expose operational truth, not only user artifacts.

Minimum instrumentation:

- Structured logs with `run_id`, `workspace_id`, `route`, `job_id`, `provider`, `model`, and `stage`.
- Request latency and status metrics for API routes.
- Queue metrics: waiting, active, completed, failed, retry count.
- AI run stage metrics: duration, failure type, degradation reasons.
- LLM metrics from `LlmCall`: tokens, latency, status, provider/model.
- Data freshness metrics from `DataFreshnessCheck`.

Future operations endpoints:

```text
GET /operations/provider-health
GET /operations/llm-calls
GET /operations/data-freshness
GET /operations/queue
```

## Error Model

Use stable error shapes:

```json
{
  "error": {
    "code": "workspace_forbidden",
    "message": "Workspace access denied.",
    "request_id": "req_...",
    "details": {}
  }
}
```

Recommended error codes:

- `validation_failed`
- `workspace_forbidden`
- `not_found`
- `run_already_exists`
- `queue_unavailable`
- `provider_unavailable`
- `engine_failed`
- `data_degraded`
- `rate_limited`

Do not collapse provider failures, stale data, and missing data into generic 500 responses. They have different product meanings.

## Deployment Topology

Local development:

```text
Postgres via Docker Compose
NestJS API process
Python AI service installed locally
optional inline mode for smoke tests
```

Local API reads/writes need:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lunacrypto
WORKSPACE_MEMBERSHIPS=local:local-user:owner
```

Hosted target:

```text
Frontend static/SSR host
NestJS API service
Redis for BullMQ
Python worker service
Managed Postgres
Secret manager
Observability stack
```

The Python worker can scale independently from the API because research runs are the expensive workload.

## Data Retention

Research artifacts are valuable audit records, but payloads can become large.

Recommended policy:

- Keep core records indefinitely unless user deletes workspace data.
- Retain raw provider payloads by plan/workspace policy.
- Add export support for run bundles.
- Add deletion workflow that removes workspace-scoped artifacts consistently.
- Keep LLM call and freshness metadata long enough for reliability analysis.

## Production Hardening Checklist

- Replace trusted identity headers with real auth.
- Use BullMQ and dedicated workers for research runs.
- Add run cancellation and retry policy.
- Add route-level rate limits for expensive operations.
- Add operations endpoints for provider health, LLM calls, data freshness, and queue state.
- Add structured API error envelope.
- Add OpenAPI or generated client contract.
- Add integration tests for workspace isolation on every route.
- Add idempotency protection for `POST /research-runs`.
- Add backup/restore and migration runbooks for hosted Postgres.

## Acceptance Criteria

- Frontend can read all user-facing research artifacts through the NestJS API only.
- A research run can be queued, processed, persisted, and inspected by run ID.
- Workspace isolation is enforced before every read/write.
- Partial or degraded AI output is represented explicitly, not hidden behind failures.
- All response shapes needed by the frontend are stable and typed.
- Operational metadata exists to explain provider, model, queue, and data freshness problems.
