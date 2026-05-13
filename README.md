# LunaPerception

LunaPerception is a monorepo for a crypto research product. The current working application is the Python AI research service in `apps/ai-service`, with the product API boundary in `apps/api`; the web surfaces are scaffolded as placeholders for future development.

## Workspace Layout

```text
apps/
  ai-service/      Python LunaCrypto service and CLI
  api/             NestJS product API boundary
  web/             Future logged-in product app
  landing/         Future Next.js marketing and SEO site
packages/
  database/        Prisma schema/client for local Postgres now, hosted later
  ui-shared/       Future shared UI components
  config/          Future shared TypeScript config
  types/           Future shared API/domain types
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

For now, database work targets local Postgres through Prisma while development
focus stays on `apps/ai-service`. Start a local DB with:

```bash
docker compose --profile db up -d postgres
pnpm db:generate
pnpm db:push
```

The default local Prisma URL is
`postgresql://postgres:postgres@localhost:5432/lunacrypto`. Hosted/NestJS
deployments can provide `DATABASE_URL` later. The raw Postgres SQL file in
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
tradingagents
python -m cli.main
```

## Docker

Docker Compose remains at the repo root and builds the AI service from `apps/ai-service`.

```bash
docker compose config
docker compose build ai-service
docker compose run --rm ai-service
```

For local secrets, copy `apps/ai-service/.env.example` to `.env` at the repo root when using Docker Compose.
