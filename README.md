# LunaCrypto

Trade theses, not vibes.

LunaCrypto is a thesis discipline system for serious crypto research. It turns
market context, deterministic signals, agent debate, and journaled outcomes into
one inspectable workflow: build a thesis, know what would prove it wrong,
monitor it, and learn from the result.

The current working application spans the Python AI research service in
`apps/ai-service`, the NestJS product API boundary in `apps/api`, and a
Vite/React workstation in `apps/web`. The monorepo/package name remains
LunaPerception for compatibility with existing workspace metadata.

## Product Loop

```text
market context
-> deterministic signals
-> multi-agent research
-> structured thesis
-> user decision
-> journal
-> monitoring / evaluation
-> reliability learning
```

The commercial shape is a decision OS for crypto theses: evidence, conviction,
invalidation, monitoring, and review in one durable paper trail.

## Workspace Layout

```text
apps/
  ai-service/      Python LunaCrypto service and CLI
  api/             NestJS product API boundary
  web/             Vite/React research workstation
packages/
  database/        Prisma schema/client for the product Postgres model
docs/
  repo documentation map, feature plans, architecture notes, tracking docs,
  and UX references
```

The Python import namespace intentionally remains `luna_workstation` for compatibility; the public CLI command is `lunacrypto`.

Project documentation starts at [docs/README.md](docs/README.md). Feature
implementation plans use the versioned layout documented in
[docs/features/README.md](docs/features/README.md).

## Product Boundary

LunaCrypto is built around research artifacts and user-reviewed decisions. It
keeps the audit trail and product language focused on decision quality,
evidence, invalidation, monitoring, and review.

## Root Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm build:api
pnpm lint
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm ai:install
pnpm ai:test
```

For now, the Python service remains local-SQLite first. Product-schema work
targets local Postgres through Prisma, and the NestJS API can read/write the
Postgres journal when `DATABASE_URL` is configured. Start a local DB with:

```bash
docker compose --profile db up -d postgres
pnpm db:generate
pnpm db:push
```

The Prisma config defaults to
`postgresql://postgres:postgres@localhost:5432/lunacrypto` for CLI schema work.
When running `apps/api`, set `DATABASE_URL` explicitly if API routes need real
journal reads/writes. Without `DATABASE_URL`, API tests can still exercise
static membership and queue behavior, but repository-backed reads will return a
service-unavailable error. The raw Postgres SQL file in
`apps/api/src/database/postgres-schema.sql` is kept as compatibility/reference
material for the Python journal migration boundary.

Run a workspace command directly:

```bash
pnpm --filter @lunaperception/ai-service test
pnpm --filter @lunaperception/api lint
pnpm --filter @lunaperception/api test
```

## Release Gate Checklist

Before opening a new product phase or release candidate, run the same gates CI
enforces:

```bash
pnpm lint
pnpm build:api
pnpm --filter @lunaperception/api test

cd apps/ai-service
python -m ruff check .
python -m ruff format --check .
python -m mypy luna_workstation cli
python -m pytest
```

## AI Service

Service-specific documentation lives in `apps/ai-service/README.md`.

Install it for local development:

```bash
cd apps/ai-service
python -m venv .venv
python -m pip install -e ".[dev]"
```

Run the CLI:

```bash
lunacrypto
python -m cli.main
```

Run the worker-style engine contract:

```bash
lunacrypto engine run --request request.json
```

## API Boundary

The NestJS API exposes research, journal, thesis, signal, watchlist, brief, and
alert routes for the web workstation. Local API requests currently require
`x-user-id` and `x-workspace-id` headers, and workspace access must come from
Postgres memberships or the `WORKSPACE_MEMBERSHIPS` environment variable.

Composite research and journal workspace responses include `stage_timings`, an
event-derived view of each workflow stage with `pending`, `running`,
`completed`, `failed`, or `missing` state plus start/completion timestamps,
duration, and source event IDs. The web workstation uses this contract to render
the agent workflow visualization.

## Web Workstation

The web app is a local-first research workstation built with Vite, React,
React Router, TanStack Query, and local CSS primitives. It provides workbench,
research launcher/history/workspace, journal workspace, thesis library/detail,
signals, scenarios, alerts, watchlists, briefs, operations, settings,
performance, and comparison routes.

Run it with the API:

```bash
pnpm dev
```

Or run the two processes separately:

```bash
pnpm --filter @lunaperception/api dev
pnpm --filter @lunaperception/web dev
```

Queue behavior is controlled by:

```text
JOBS_EXECUTION_MODE=memory
REDIS_URL=redis://...
PYTHON_ENGINE_COMMAND=lunacrypto
PYTHON_ENGINE_ARGS="engine run --request"
```

Watchlist alert checks refresh exchange prices before evaluating thesis rules.
The live price feed defaults to Binance public ticker and can be configured with:

```text
PRICE_REFRESH_ON_CHECK=true
PRICE_FEED_BASE_URL=https://api.binance.com
PRICE_FEED_TIMEOUT_MS=2500
WATCHLIST_ALERT_POLL_ENABLED=false
WATCHLIST_ALERT_POLL_INTERVAL_MS=60000
WATCHLIST_ALERT_POLL_LIMIT=100
```

## Docker

Docker Compose remains at the repo root and now starts the product stack by
default: Postgres, Redis, NestJS API, BullMQ worker, and the web app.

```bash
docker compose config
docker compose up --build
```

The API publishes `GET /health` and `GET /openapi.json`. The web app listens on
`http://localhost:3001` and proxies `/backend` to the API container. The Python
AI CLI image remains available with `docker compose --profile ai run --rm ai-service`.

For local secrets, copy `apps/ai-service/.env.example` to `.env` at the repo root when using Docker Compose.
