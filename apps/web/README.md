# LunaCrypto Web

Local-first web workstation for the LunaCrypto research workflow.

## Stack

- Vite + React + TypeScript.
- React Router for workstation routes.
- TanStack Query for API-backed server state.
- Axios transport through `src/services/client.ts`.
- Local CSS primitives in `src/styles/index.css`.
- `lucide-react` icons for dense workstation controls.

## Local Development

Run the API on port `3000` and the web app on port `3001`.

```bash
docker compose --profile db up -d postgres
pnpm db:generate
pnpm db:push

$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lunacrypto"
$env:WORKSPACE_MEMBERSHIPS="local:local-user:owner"
$env:JOBS_EXECUTION_MODE="memory"
pnpm --filter @lunaperception/api dev

pnpm --filter @lunaperception/web dev
```

From the repo root, `pnpm dev` starts the API and web app together.

The browser-facing API base is `VITE_API_BASE_URL` and defaults to `/backend`.
When using that default, Vite proxies `/backend` to `API_BASE_URL`, which defaults
to `http://localhost:3000`.

The Research Continuity repair/backfill panel is maintenance-only and hidden by
default. Set `VITE_ENABLE_RESEARCH_CONTINUITY_REPAIR=true` only for admin repair
sessions.

The current MVP uses local header auth only:

```text
x-user-id: local-user
x-workspace-id: local
```

This is for development and local private testing. Hosted auth comes later.

## Routes

The app shell redirects `/` to `/workbench` and currently includes:

| Route | Purpose |
| --- | --- |
| `/workbench` | Daily command center for briefs, alerts, theses, signals, watchlists, and recent runs |
| `/research/new` | Research run launcher |
| `/research/history` | Research run list/history |
| `/research/runs/:id` | Research workspace with status, timeline, snapshots, debate, thesis, artifacts, and workflow visualization |
| `/journal/runs/:id` | Journal-backed evidence workspace for a run |
| `/theses` and `/theses/:id` | Thesis library and thesis detail workflow |
| `/signals` and `/signals/:id` | Signal explorer and detail view |
| `/scenarios` | Scenario monitor |
| `/alerts` | Alert inbox and mark-read workflow |
| `/watchlists` | Watchlist management |
| `/briefs/daily` | Daily brief archive |
| `/operations` | Provider, model, freshness, and operations surface |
| `/settings` | Local auth/API mode and workspace settings |
| `/performance` | Outcome and reliability analytics surface |
| `/compare` | Run/thesis comparison surface |

## API Contract

Frontend types are mirrored in `src/services/generated/api-client.ts` and
`src/types/index.ts`. The backend source of truth is
`apps/api/src/contracts/frontend-contract.ts` plus the generated OpenAPI
document.

Research and journal workspace responses include `stage_timings`, which powers
the agent workflow visualization. Each timing row exposes:

```text
stage_key
label
event_state: pending | running | completed | failed | missing
started_at
completed_at
duration_ms
source_event_ids
```

Keep this field in sync when changing research-run event semantics.

## Verification

```bash
pnpm --filter @lunaperception/web lint
pnpm --filter @lunaperception/web typecheck
pnpm --filter @lunaperception/web build
```
