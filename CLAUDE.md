# CLAUDE.md

This file provides guidance to Claude Code when working in the LunaPerception monorepo.

## Common Commands

```bash
# Root workspace
pnpm install
pnpm lint
pnpm build:api
pnpm typecheck
pnpm test

# TypeScript API
pnpm --filter @lunaperception/api lint
pnpm --filter @lunaperception/api test

# Python AI service
pnpm ai:install
pnpm ai:test
pnpm --filter @lunaperception/ai-service lint
pnpm --filter @lunaperception/ai-service typecheck
pnpm --filter @lunaperception/ai-service test
```

Run Python commands directly from `apps/ai-service`:

```bash
cd apps/ai-service
python -m pip install -e ".[dev]"
lunacrypto
python -m cli.main
python -m pytest
python -m mypy tradingagents cli
python -m ruff check .
python -m ruff format --check .
```

## Repository Layout

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

The current production code lives in `apps/ai-service`, with the product API boundary in `apps/api`. `apps/web` is only a placeholder, and no shared UI/config/types packages exist yet.

## AI Service Notes

- Keep the Python import namespace `tradingagents` stable, but expose the public CLI as `lunacrypto`.
- Service-specific docs are in `apps/ai-service/README.md`.
- Docker Compose is still run from the repo root, but builds from `apps/ai-service`.
- Local runtime state is still under `~/.tradingagents/`.
- The Python journal is SQLite-backed. `packages/database` and `apps/api` model the product Postgres boundary; set `DATABASE_URL` when API routes need repository-backed reads/writes.
- The graph does not place live orders; execution remains outside the AI research boundary.
