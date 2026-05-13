# LunaPerception

LunaPerception is a monorepo for a crypto research product. The current working application is the Python AI research service in `apps/ai-service`, with a NestJS product API boundary in `apps/api`. The web app directory is currently only a placeholder.

## Workspace Layout

```text
apps/
  ai-service/      Python LunaCrypto service and CLI
  api/             NestJS product API boundary
  web/             Placeholder for the future logged-in product app
packages/
  database/        Prisma schema/client for the product Postgres model
docs/
  backend/frontend architecture notes and UX references
```

The Python import namespace intentionally remains `tradingagents` for compatibility; the public CLI command is `lunacrypto`.

## Root Commands

```bash
pnpm install
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
python -m mypy tradingagents cli
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
alert routes for the future product UI. Local API requests currently require
`x-user-id` and `x-workspace-id` headers, and workspace access must come from
Postgres memberships or the `WORKSPACE_MEMBERSHIPS` environment variable.

Queue behavior is controlled by:

```text
JOBS_EXECUTION_MODE=inline
REDIS_URL=redis://...
PYTHON_ENGINE_COMMAND=lunacrypto
PYTHON_ENGINE_ARGS="engine run --request"
```

## Docker

Docker Compose remains at the repo root and builds the AI service from `apps/ai-service`.

```bash
docker compose config
docker compose build ai-service
docker compose run --rm ai-service
```

For local secrets, copy `apps/ai-service/.env.example` to `.env` at the repo root when using Docker Compose.
