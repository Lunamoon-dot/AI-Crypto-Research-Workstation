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
python -m mypy luna_workstation cli
python -m ruff check .
python -m ruff format --check .
```

## Repository Layout

```text
apps/
  ai-service/      Python LunaCrypto service and CLI
  api/             NestJS product API boundary
  web/             Vite/React research workstation
packages/
  database/        Prisma schema/client for the product Postgres model
docs/
  backend/frontend architecture notes and UX references
```

The current product surface spans `apps/ai-service`, `apps/api`, and `apps/web`. The web app uses Vite, React Router, TanStack Query, local CSS primitives, and a generated/mirrored API client under `apps/web/src/services`.

## AI Service Notes

- Keep the Python import namespace `luna_workstation` stable, but expose the public CLI as `lunacrypto`.
- Service-specific docs are in `apps/ai-service/README.md`.
- Docker Compose is still run from the repo root, but builds from `apps/ai-service`.
- Local runtime state is still under `~/.luna_workstation/`.
- The Python journal is SQLite-backed. `packages/database` and `apps/api` model the product Postgres boundary; set `DATABASE_URL` when API routes need repository-backed reads/writes.
- The graph does not place live orders; execution remains outside the AI research boundary.
