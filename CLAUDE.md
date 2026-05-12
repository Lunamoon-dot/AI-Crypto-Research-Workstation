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
tradingagents
python -m cli.main
python -m pytest
python -m mypy tradingagents cli
python -m ruff check .
python -m ruff format --check .
```

## Repository Layout

```text
apps/
  ai-service/      Python TradingAgents service and CLI
  api/             NestJS product API boundary
  web/             Future logged-in product app
  landing/         Future Next.js marketing site
packages/
  database/        Future shared database schema/client
  ui-shared/       Future shared UI components
  config/          Future shared TypeScript config
  types/           Future shared API/domain types
```

The current production code lives in `apps/ai-service`, with the product API boundary in `apps/api`. The web apps and shared packages are placeholders until those surfaces are implemented.

## AI Service Notes

- Keep the Python import namespace `tradingagents` and CLI command `tradingagents` stable.
- Service-specific docs are in `apps/ai-service/README.md`.
- Docker Compose is still run from the repo root, but builds from `apps/ai-service`.
- Local runtime state is still under `~/.tradingagents/`.
- The graph does not place live orders; execution remains outside the AI research boundary.
