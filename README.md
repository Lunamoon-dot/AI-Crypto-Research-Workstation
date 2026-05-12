# LunaPerception

LunaPerception is a monorepo for a crypto research product. The current working application is the Python AI research service in `apps/ai-service`; the web surfaces and TypeScript backend are scaffolded as placeholders for future development.

## Workspace Layout

```text
apps/
  ai-service/      Python TradingAgents service and CLI
  api/             NestJS product API boundary
  landing-page/    Future Next.js marketing and SEO site
  web-app/         Future React or Next.js user dashboard
  server/          Future backend workspace placeholder
packages/
  database/        Future shared database schema/client
  ui-shared/       Future shared UI components
  config/          Future shared TypeScript config
  types/           Future shared API/domain types
```

The Python package and CLI intentionally keep the existing `tradingagents` name for compatibility.

## Root Commands

```bash
pnpm install
pnpm build
pnpm build:api
pnpm lint
pnpm test
pnpm typecheck
pnpm ai:install
pnpm ai:test
```

Run a workspace command directly:

```bash
pnpm --filter @lunaperception/ai-service test
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
