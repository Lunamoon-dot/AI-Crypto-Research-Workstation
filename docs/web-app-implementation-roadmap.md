# LunaCrypto Web App Implementation Roadmap

Status: execution checklist for `apps/web`
Created: 2026-05-13
Scope: logged-in AI crypto research workstation, local-first/private-beta first

This file turns the current repo assessment into an ordered implementation
roadmap. It assumes the existing Python AI service, NestJS API, and
Prisma/Postgres schema remain the source of truth for research artifacts.

## 0. Verdict

The assessment is reasonable.

The repo is already shaped for a serious AI crypto research workstation:

- `apps/ai-service` owns the actual AI research workflow.
- `apps/api` exposes a frontend-facing product boundary.
- `packages/database/prisma/schema.prisma` already models research runs,
  snapshots, debates, theses, scenarios, signals, watchlists, alerts, briefs,
  provider health, LLM calls, freshness checks, decisions, and reviews.
- `apps/web` is still only a placeholder, so the next high-leverage work is to
  build the web workstation against the API boundary.

The product should not be built as a trading bot, execution terminal, or fake
PnL dashboard. The strongest product shape is:

```text
market context
-> deterministic signals
-> multi-agent research
-> structured thesis
-> user decision
-> journal
-> outcome review
-> reliability learning
```

The first production-quality web version should be local-first or private beta.
Hosted SaaS, real multi-user auth, billing, and team workflows should come only
after the research/journal loop is useful end to end.

## 1. Non-Negotiable Product Rules

- Browser calls only `apps/api`; never call the Python AI service directly from
  the browser.
- Every thesis screen must show evidence, contradictions, freshness, missing
  data, confidence, invalidation, and monitor-next fields near the decision.
- Every AI output must remain inspectable through run IDs, thesis IDs, signal
  IDs, source timestamps, payload drawers, and timeline events.
- Use research language: "Run research", "Watch", "Review", "Record decision",
  "Scenario active", "Invalidation risk".
- Do not use execution language: "Buy now", "Sell now", "Auto trade",
  "Guaranteed", "Profit signal", "Enter trade".
- Do not add order execution, position management, leverage automation, or
  broker integration in the web MVP.
- Do not show Sharpe, alpha, annualized return, or broker-style PnL unless a
  real simulator/execution ledger exists.
- The first screen after login is the workstation, not a marketing landing page.
- Keep local auth headers behind a provider abstraction so real auth can replace
  them without rewriting screens.

## 2. Current Backend Surface To Use First

Existing frontend-facing routes confirmed in `apps/api/src`:

| Capability | Route | Web use |
| --- | --- | --- |
| Create research run | `POST /research-runs` | Run launcher |
| Read run | `GET /research-runs/:id` | Run header/status |
| Read run events | `GET /research-runs/:id/events` | Timeline/polling |
| Read snapshots | `GET /research-runs/:id/snapshots` | Market and signal snapshot panels |
| Read debate | `GET /research-runs/:id/debate` | Agent debate panel |
| Read run workspace | `GET /research-runs/:id/workspace` | Composite research workspace |
| Read journal workspace | `GET /journal/runs/:id/workspace` | Composite evidence workspace |
| List theses | `GET /theses` | Thesis inbox |
| Read thesis | `GET /theses/:id` | Thesis detail |
| Read scenarios | `GET /theses/:id/scenarios` | Scenario radar |
| Record decision | `POST /theses/:id/decision` | Decision journal |
| Record review | `POST /theses/:id/review` | Outcome review |
| List signals | `GET /signals` | Signal explorer |
| List watchlists | `GET /watchlists` | Watchlist overview |
| Add watchlist item | `POST /watchlists/:id/items` | Add symbol/thesis/setup |
| List daily briefs | `GET /briefs/daily` | Daily brief page |
| List alerts | `GET /alerts` | Alerts inbox |
| Mark alert read | `POST /alerts/:id/read` | Alerts inbox action |

Current local identity headers:

```text
x-user-id
x-workspace-id
```

Current run creation payload:

```json
{
  "workspace_id": "local",
  "symbol": "BTC/USDT",
  "asset_class": "crypto",
  "market_type": "spot",
  "analysis_date": "2026-05-13",
  "analysts": ["market", "news", "social", "onchain", "quant", "risk"],
  "config_profile": "default"
}
```

## 3. Known Gaps That Affect Web Order

Some web screens can be built immediately, but a few backend gaps should be
handled before claiming the app is production-ready.

| Gap | Priority | Why it matters | Earliest phase |
| --- | --- | --- | --- |
| `GET /research-runs` list | P0 | Workbench/recent runs need a list view | Phase 6 |
| `GET /jobs/:id` or run status projection | P0 | `POST /research-runs` returns `job_id` but no job status route exists | Phase 8 |
| Stable API error envelope | P0 | Web needs consistent validation/auth/provider error states | Phase 4 |
| OpenAPI or generated client | P1 | Prevent DTO drift between API and web | Phase 5 |
| `GET /watchlists/:id/items` | P1 | Watchlist page needs items, not only watchlist headers | Phase 12 |
| `POST /watchlists` | P1 | Users need to create watchlists | Phase 12 |
| `PATCH /watchlists/:id` | P1 | Rename/enable/disable watchlists | Phase 12 |
| `DELETE /watchlists/:id/items/:itemId` | P1 | Remove stale watches | Phase 12 |
| Provider health endpoints | P1 | Settings/operations trust surface | Phase 14 |
| Config/profile endpoints | P1 | Run launcher should not hardcode profiles forever | Phase 14 |
| Retrospective endpoints | P2 | Reliability analytics | Phase 17 |
| Compare/diff endpoints | P2 | Signature differentiation | Phase 16 |
| Real auth/session | P0 for hosted | Header identity is acceptable only for local/private beta | Phase 20 |
| Workspace RBAC hardening | P0 for hosted | Team/cloud mode requires real isolation | Phase 20 |

## 3.1 Recommended Technical Decisions

This roadmap should be opinionated so implementation does not stall on every
tooling choice. These are the default recommendations unless the owner rejects a
specific tradeoff.

| Area | Recommendation | Why |
| --- | --- | --- |
| Web framework | Next.js App Router | Good route organization, server/client boundaries, middleware support, and deployment ergonomics |
| UI runtime | React + TypeScript | Matches repo TypeScript/NestJS direction and keeps the web strongly typed |
| Styling | Tailwind CSS with local primitives | Fast workstation UI without introducing a premature design-system package |
| Icons | `lucide-react` | Consistent icon set for dense operational UI |
| Server state | TanStack Query | Polling, caching, retries, mutation states, and query invalidation fit this app well |
| Forms | React Hook Form + Zod | Clear form validation for run launch, decisions, reviews, watchlists, and settings |
| Accessible primitives | Radix UI for Dialog, Select, Tabs, Tooltip, Popover | Avoid hand-rolling keyboard/focus behavior |
| Tables | Native table first, TanStack Table when sorting/column state grows | Avoid overbuilding early list views |
| Dates | `date-fns` or small local helpers | Keep timestamp formatting predictable |
| Charts | Recharts later, only for retrospective analytics | Do not add charting before reliability screens exist |
| API contract | Manual mirrored types first, then OpenAPI/codegen | Fast start now, stable contract before hosted beta |
| Tests | Vitest, React Testing Library, Playwright | Unit, component, and browser smoke coverage |
| Auth during dev/FE-BE MVP | Keep current local/header auth, hidden behind provider abstraction | Security is not the bottleneck yet; avoid blocking product workflow work |
| Auth architecture | Build auth abstraction now, not real hosted auth now | Prevents a future rewrite while keeping dev velocity high |
| Auth hosted-beta checkpoint | Decide between Clerk, Better Auth, or Auth0 before external users | Hosted auth matters only when leaving local/private dev |
| Auth hosted-beta default | Clerk Organizations + JWT verification in NestJS, if no owner objection | Fastest safe path for SaaS-like workspaces, invites, sessions, MFA/passkeys, and org roles |
| Auth self-host fallback | Better Auth | Best fallback if vendor avoidance/local-first ownership becomes more important than speed |
| Enterprise auth fallback | Auth0 | Better fit if enterprise SSO, procurement, and mature B2B IAM matter earlier |

External docs checked for the auth recommendation:

- Next.js authentication guide: `https://nextjs.org/docs/app/guides/authentication`
- Clerk Next.js SDK and Organizations docs: `https://clerk.com/docs/nextjs/overview`,
  `https://clerk.com/docs/nextjs/guides/organizations/getting-started`
- Clerk manual JWT verification docs:
  `https://clerk.com/docs/backend-requests/manual-jwt`
- Auth0 JWKS and Organizations token docs: `https://auth0.com/docs/jwks`,
  `https://auth0.com/docs/organizations/using-tokens`
- Better Auth docs: `https://better-auth.com/docs/introduction`
- Auth.js docs: `https://authjs.dev/`

## 3.2 Auth Recommendation

Recommended auth path:

```text
Phase A, current dev/FE-BE MVP:
  keep x-user-id and x-workspace-id headers
  hide them behind Web AuthProvider and API AuthService
  do not integrate Clerk/Auth0/Better Auth yet
  do not hand-roll JWT user auth

Phase B, pre-hosted checkpoint:
  choose hosted auth provider only when external users/workspaces are planned
  default recommendation remains Clerk Organizations
  Better Auth is the self-host fallback
  Auth0 is the enterprise IAM fallback

Phase C, hosted private beta:
  Web gets a session token/JWT from Clerk
  Web sends Authorization: Bearer <token> to NestJS API
  API verifies JWT using Clerk SDK or JWKS
  API maps external user/org claims to local User, Workspace, WorkspaceMembership rows
  API enforces workspace RBAC from local database, not from frontend input

Phase D, enterprise/pro:
  add SSO/SAML only when customers actually require it
  Auth0 can replace Clerk if enterprise IAM becomes the primary requirement
```

Current dev decision:

```text
Use local/header auth now.
Do not spend implementation time on real user auth until the web research loop is useful.
Do not build custom JWT user auth as a temporary step.
```

Why this is acceptable during dev:

- The app is not yet hosted for untrusted external users.
- Current API already expects local identity headers.
- The main risk right now is building the wrong product workflow, not losing
  production user sessions.
- Header auth is fine for local/private development if every file labels it as
  dev-only and no public deployment trusts it.

What must still be done now:

- Keep identity and workspace access behind abstractions.
- Keep all API routes workspace-scoped.
- Do not scatter `x-user-id` and `x-workspace-id` across components.
- Do not store real provider secrets in the frontend.
- Do not claim the app is hosted-production-safe while local headers are active.

Why Clerk remains the default later:

- The app is likely to need organizations/workspaces, invitations, user
  management, sessions, social login, MFA/passkeys, and role checks before it
  needs fully custom auth.
- Auth is not the product moat. The moat is research memory, thesis lifecycle,
  evidence, diff, and reliability analytics.
- Managed auth lowers security implementation risk for hosted beta.
- NestJS can stay provider-neutral by verifying bearer tokens through an
  `AuthProviderAdapter` interface.

Why not hand-written JWT first:

- A secure custom implementation is not just "issue a JWT".
- It needs password hashing, email verification, reset tokens, session
  revocation, refresh-token rotation, CSRF policy, MFA, device/session
  management, abuse protection, audit logging, and key rotation.
- That work delays the research workstation without improving the core product.

When to choose Better Auth instead:

- You want self-hosted auth from day one.
- You do not want user identity to depend on a SaaS vendor.
- Local-first/offline ownership matters more than fastest hosted beta.
- You are willing to own auth database tables, migrations, email flows, session
  hardening, and future SSO complexity.

When to choose Auth0 instead:

- Enterprise SSO, B2B IAM procurement, and mature organization/tenant controls
  are more important than developer-speed UI components.
- Customers explicitly require Auth0-compatible IAM patterns.

Owner decision to confirm before hosted beta, not before local MVP:

```text
Default recommendation: Clerk Organizations.
Alternative: Better Auth if vendor avoidance/self-hosting is a hard requirement.
Alternative: Auth0 if enterprise SSO/B2B IAM is the first paid market.
```

## 3.3 Auth Architecture Blueprint

### Local/private-beta mode

Current API behavior:

```text
x-user-id: local-user
x-workspace-id: local
```

Rules:

- Only use local header auth in development/private local deployments.
- Web components never set these headers directly.
- `apps/web/src/auth/auth-provider.tsx` owns local identity state.
- `apps/web/src/api/client.ts` translates local identity into headers.
- The API keeps `AuthService.resolveUser()` and
  `WorkspacesService.resolveWorkspace()` for local mode.

Done when:

- Local mode is useful but clearly marked as not hosted-auth-safe.

### Hosted mode

Request flow:

```text
Browser
-> Clerk session
-> Web gets session JWT
-> Authorization: Bearer <jwt>
-> NestJS AuthGuard verifies token
-> AuthService resolves external subject to local User
-> WorkspacesService resolves external org to local Workspace
-> WorkspaceMembership enforces role
-> Controller/service runs
```

API rules:

- Do not trust `x-user-id` or `x-workspace-id` in hosted mode.
- Do not trust `workspace_id` from request body as authorization.
- If a request includes `workspace_id`, assert it matches the authenticated
  active workspace.
- Store provider user/org IDs in local database so authorization does not depend
  only on frontend claims.
- API route authorization belongs in NestJS, not only in Next.js middleware.
- All expensive operations must require `analyst` or `owner`.

Recommended API auth files:

```text
apps/api/src/auth/
  auth.module.ts
  auth.guard.ts
  auth.service.ts
  auth.types.ts
  current-user.decorator.ts
  workspace.decorator.ts
  roles.decorator.ts
  roles.guard.ts
  providers/
    auth-provider.adapter.ts
    local-auth-provider.ts
    clerk-auth-provider.ts
    auth0-auth-provider.ts
  jwt/
    jwks-client.ts
    jwt-verifier.ts
```

Recommended API authorization files:

```text
apps/api/src/authorization/
  authorization.module.ts
  permissions.ts
  role-policy.ts
  workspace-policy.ts
```

Recommended web auth files:

```text
apps/web/src/auth/
  auth-provider.tsx
  auth-types.ts
  local-auth.ts
  hosted-auth.ts
  require-auth.tsx
  workspace-switcher.tsx
```

If using Clerk, add:

```text
apps/web/middleware.ts
apps/web/src/auth/clerk-provider.tsx
apps/web/src/auth/clerk-token.ts
```

### Token policy

Hosted mode should use:

- Short-lived bearer access token/JWT sent to NestJS.
- Provider-managed session cookies in the web app.
- API-side JWT verification via SDK or JWKS.
- No long-lived API token in localStorage.
- No secrets in `NEXT_PUBLIC_*` variables.

For machine-to-machine later:

- Use separate service tokens for workers/internal services.
- Do not reuse browser session tokens for Python workers.

## 3.4 RBAC Matrix

Initial roles:

```text
owner
analyst
reviewer
viewer
```

Permission matrix:

| Capability | Owner | Analyst | Reviewer | Viewer |
| --- | --- | --- | --- | --- |
| Read workbench | yes | yes | yes | yes |
| Read runs/theses/signals/briefs/alerts | yes | yes | yes | yes |
| Create research run | yes | yes | no | no |
| Create/update watchlist | yes | yes | no | no |
| Record thesis decision | yes | yes | yes | no |
| Record outcome review | yes | yes | yes | no |
| Mark alerts read | yes | yes | yes | no |
| View operations/provider health | yes | yes | yes | yes |
| Manage provider/settings | yes | no | no | no |
| Manage workspace members | yes | no | no | no |
| Delete/export workspace data | yes | no | no | no |

Rules:

- A `viewer` can inspect research but cannot mutate journal state.
- A `reviewer` can record decisions/reviews but cannot launch expensive runs.
- An `analyst` can launch runs and manage watchlists.
- An `owner` manages workspace, settings, provider configuration, and exports.

## 3.5 Auth-Related Database Recommendations

Current Prisma models already include:

```text
User
Workspace
WorkspaceMembership
```

For hosted auth, extend them later with provider mapping fields:

```text
User
  authProvider        String?
  externalAuthId      String?  unique
  emailVerifiedAt     DateTime?
  lastLoginAt         DateTime?

Workspace
  externalOrgId       String?  unique
  slug                String?  unique

WorkspaceMembership
  externalMembershipId String?
  invitedByUserId      String?
  status               String?  # active, invited, suspended
```

Add before hosted beta:

```text
AuditLog
  id
  workspaceId
  actorUserId
  action
  entityType
  entityId
  createdAt
  payloadJson
```

If using Better Auth instead of Clerk/Auth0:

- Add Better Auth tables through its migration flow or explicitly map its
  required schema.
- Keep product `User`, `Workspace`, and `WorkspaceMembership` as the app-level
  authorization model even if auth tables are separate.

## 3.6 Standard Project Folder Organization

The web app should be organized by route groups and feature ownership, not by a
flat pile of components.

Recommended `apps/web` structure:

```text
apps/web/
  app/
    layout.tsx
    page.tsx
    globals.css
    middleware.ts                 # only when hosted auth is enabled
    (auth)/
      sign-in/
        page.tsx
      sign-up/
        page.tsx
    (workstation)/
      layout.tsx
      workbench/
        page.tsx
      research/
        new/
          page.tsx
        runs/
          [id]/
            page.tsx
      journal/
        runs/
          [id]/
            page.tsx
      theses/
        page.tsx
        [id]/
          page.tsx
      signals/
        page.tsx
      alerts/
        page.tsx
      watchlists/
        page.tsx
        [id]/
          page.tsx
      briefs/
        daily/
          page.tsx
          [id]/
            page.tsx
      retrospective/
        page.tsx
      operations/
        page.tsx
      settings/
        page.tsx
  src/
    api/
      client.ts
      query-keys.ts
      types.ts
      research-runs.ts
      theses.ts
      signals.ts
      alerts.ts
      watchlists.ts
      briefs.ts
      operations.ts
      settings.ts
    app/
      app-shell.tsx
      providers.tsx
      sidebar-nav.tsx
      top-command-strip.tsx
    auth/
      auth-provider.tsx
      auth-types.ts
      local-auth.ts
      hosted-auth.ts
      require-auth.tsx
      workspace-switcher.tsx
    components/
      ui/
      research/
      layout/
    features/
      workbench/
      research-runs/
      theses/
      signals/
      alerts/
      watchlists/
      briefs/
      retrospective/
      operations/
      settings/
    lib/
      dates.ts
      env.ts
      format.ts
      ids.ts
      freshness.ts
      routes.ts
      utils.ts
    styles/
    test/
      mocks/
      render.tsx
```

Feature folder convention:

```text
src/features/<feature>/
  components/
  hooks/
  schemas/
  utils/
  <feature>-page.tsx
```

Rules:

- `app/**/page.tsx` should be thin and route-focused.
- Feature components own screen composition.
- `src/api` owns all HTTP paths.
- `src/auth` owns identity/session/workspace context.
- `src/components/ui` owns generic primitives.
- `src/components/research` owns domain UI shared across features.
- Do not create `packages/ui` until at least two apps need it.
- Do not create `packages/contracts` until the API contract is stable enough to
  share or generate.

Recommended future shared packages:

```text
packages/contracts/   # generated or shared API DTOs
packages/config/      # shared eslint/tsconfig/tailwind only if needed
packages/ui/          # only after repeated UI reuse across apps
```

## 3.7 Environment Variables

Local web:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_MODE=local
NEXT_PUBLIC_LOCAL_USER_ID=local-user
NEXT_PUBLIC_LOCAL_WORKSPACE_ID=local
```

Hosted web with Clerk, later only:

```text
NEXT_PUBLIC_AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
CLERK_JWT_TEMPLATE=lunacrypto-api
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

Hosted API:

```text
AUTH_MODE=jwt
AUTH_PROVIDER=clerk
AUTH_JWT_ISSUER=...
AUTH_JWT_AUDIENCE=lunacrypto-api
AUTH_JWKS_URL=...
DATABASE_URL=...
REDIS_URL=...
```

Rules:

- Never put provider secret keys into `NEXT_PUBLIC_*`.
- Keep AI provider keys on API/worker side only.
- Web should know only publishable auth keys and API base URL.
- API should own JWT verification, workspace access, rate limits, and audit
  logging.
- During current dev/FE-BE MVP, only the local web variables are required.
- Clerk/Auth0/Better Auth env vars are not required until the hosted-beta
  checkpoint.

## 3.8 Owner Decisions To Confirm Later

Use these as explicit product/engineering questions before hosted beta:

1. Confirm auth provider: Clerk default, Better Auth self-host fallback, or
   Auth0 enterprise fallback.
2. Confirm first login methods: email magic link, Google/GitHub OAuth,
   email/password, passkey, or a combination.
3. Confirm whether organizations/workspaces are mandatory for every user.
4. Confirm whether invite flow is needed in the first hosted beta.
5. Confirm whether MFA/passkey is required at launch or only for owners.
6. Confirm whether API and web share the same domain or use cross-origin bearer
   tokens.
7. Confirm whether local-first mode must keep working without hosted auth.
8. Confirm whether enterprise SSO is required before paid launch.

Default answers unless changed later:

```text
current dev auth: local/header auth
current login UI: none
current organization UI: local workspace selector only if useful
hosted auth provider later: Clerk
hosted login methods later: email magic link + Google/GitHub OAuth
hosted organization required later: yes
hosted invite flow later: yes, but after local MVP
hosted MFA/passkey later: owner/admin recommended first, optional for others
hosted API/web topology later: separate API accepted, bearer token required
local-first mode: keep local header mode for development/local deployment
enterprise SSO: later, only if needed
```

## 3.9 Current Local MVP Implementation Status

Updated: 2026-05-13

Implemented for the local/private FE-BE MVP:

- [x] Next.js workstation app under `apps/web` with route-group shell.
- [x] Local/header auth hidden behind web auth and API client abstractions.
- [x] Workbench route for briefs, alerts, theses, signals, watchlists, and
  recent research runs.
- [x] Research run launcher through `POST /research-runs`.
- [x] Research run workspace for status, timeline, snapshots, debate, thesis,
  data quality, and job-pending state.
- [x] Thesis library and thesis detail with evidence, contradictions, stale or
  missing data, scenarios, invalidation, monitor-next, decision form, and
  outcome review form.
- [x] Signal explorer.
- [x] Alerts inbox with mark-read action.
- [x] Basic watchlist maintenance: create, rename, enable/disable, list items,
  add item, and remove item.
- [x] Daily brief archive.
- [x] Settings page that exposes local auth/API mode.
- [x] Operations page with honest empty states for provider/model/freshness
  endpoints that do not exist yet.
- [x] Backend MVP additions: `GET /research-runs`, `GET /jobs/:id`, and
  watchlist CRUD/items endpoints.
- [x] Local MVP gates verified: `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  and `pnpm test`.

Explicitly deferred beyond this MVP foundation:

- [ ] Hosted auth with Clerk/Auth0/Better Auth.
- [ ] Hosted workspace RBAC hardening and role matrix tests across every route.
- [ ] BullMQ production workers and dedicated Python worker deployment.
- [ ] Provider health, LLM call, data freshness, queue, and config-health
  operations endpoints.
- [ ] OpenAPI/code-generated frontend client.
- [ ] Watchlist scheduled/manual monitoring engine.
- [ ] Compare/diff routes for runs and theses.
- [ ] Retrospective reliability analytics and calibration dashboards.
- [ ] Export bundles, markdown/PDF export, and research package sharing.
- [ ] External notifications through email, Telegram, Discord, or webhooks.
- [ ] Billing, hosted SaaS packaging, team invites, and enterprise SSO.
- [ ] Broker/exchange execution, auto-trading, leverage automation, and fake PnL
  dashboards.

## 4. Delivery Milestones

Use these milestones as merge boundaries.

| Milestone | Result | Must pass |
| --- | --- | --- |
| M0 | Roadmap and scope locked | This file reviewed |
| M1 | Web app boots | `pnpm --filter @lunaperception/web build` |
| M2 | Web can call API | Typed API client, auth headers, error handling |
| M3 | Research run loop works | Launch run, poll/read run, inspect workspace |
| M4 | Thesis lifecycle works | List thesis, detail, decision, review |
| M5 | Monitoring loop works | Signals, alerts, watchlists, briefs |
| M6 | Differentiators work | Diff, contradiction map, scenario radar |
| M7 | Production hardening done | Real auth/RBAC/queue/worker/observability |

Do not start hosted SaaS work before M5 is usable locally.

## 5. Phase 0 - Repo And Scope Lock

Goal: make sure everyone builds the same product, not a generic dashboard.

### WEB-0001 - Confirm app identity

- Product name in web: `LunaCrypto Research Workstation`.
- Short positioning: `AI crypto research workstation`.
- Avoid product copy that implies autonomous execution.
- Add copy rules to future web README.

Done when:

- No route, nav item, or button says `Trading`, `Orders`, `Positions`,
  `Execution`, or `Auto trade`.
- Nav uses research concepts: Workbench, Research, Journal, Theses, Signals,
  Watchlists, Briefs, Retrospective, Operations, Settings.

### WEB-0002 - Choose implementation stack

Recommended stack:

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS.
- TanStack Query.
- React Hook Form.
- Zod for form schemas.
- Radix UI for accessible dialog/select/tabs/tooltip primitives.
- Local component primitives first, built on top of Radix only where needed.
- `lucide-react` for icons.
- `date-fns` or a small local date helper for formatting.
- Recharts only when reliability/analytics charts are actually implemented.
- Local/header auth for the current dev/FE-BE MVP.
- Hosted auth provider selected later at the hosted-beta decision checkpoint.

Do not add:

- Global Redux/Zustand for server state.
- A shared UI package before repeated usage exists.
- Heavy charting libraries before analytics screens need them.
- A marketing template or landing-page framework.
- Clerk/Auth0/Better Auth packages during the first local web MVP unless the
  owner explicitly moves the project into hosted-beta auth work.
- Custom JWT user-auth scaffolding as a temporary bridge.

Done when:

- The stack decision is reflected in `apps/web/package.json`.
- Root `pnpm-workspace.yaml` already includes `apps/*`, so no workspace change is
  needed unless the package name is unusual.

### WEB-0003 - Define local environment contract

Document the default local contract:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_LOCAL_USER_ID=local-user
NEXT_PUBLIC_LOCAL_WORKSPACE_ID=local
```

Backend local env expected:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lunacrypto
WORKSPACE_MEMBERSHIPS=local:local-user:owner
JOBS_EXECUTION_MODE=inline
```

Done when:

- Web README explains local env.
- API requests do not scatter local header literals throughout components.

## 6. Phase 1 - Backend Smoke Before Web Work

Goal: verify the API can serve the screens before spending time on UI.

### WEB-0101 - Run existing backend gates

Commands:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
```

If Python changes are involved:

```bash
cd apps/ai-service
python -m ruff check .
python -m ruff format --check .
python -m mypy tradingagents cli
python -m pytest
```

Done when:

- Existing tests pass or failures are documented as unrelated existing work.
- Any web-blocking API failures are fixed before frontend screens depend on
  those routes.

### WEB-0102 - Verify local Postgres setup

Commands:

```bash
docker compose --profile db up -d postgres
pnpm db:generate
pnpm db:push
```

Done when:

- Prisma client generation succeeds.
- Database schema matches `packages/database/prisma/schema.prisma`.
- API routes that require `DATABASE_URL` no longer return service-unavailable.

### WEB-0103 - Create minimal API smoke script or documented curl set

Add a small manual smoke section to future web README:

```bash
curl -H "x-user-id: local-user" -H "x-workspace-id: local" \
  "http://localhost:3000/theses?limit=5"

curl -H "x-user-id: local-user" -H "x-workspace-id: local" \
  "http://localhost:3000/alerts?limit=5"
```

Done when:

- A developer can verify `theses`, `signals`, `alerts`, `briefs`, and
  `watchlists` without launching the web app.

## 7. Phase 2 - Scaffold `apps/web`

Goal: replace the placeholder with a real app that participates in PNPM/Turbo.

### WEB-0201 - Create package manifest

Create `apps/web/package.json`.

Required fields:

```json
{
  "name": "@lunaperception/web",
  "version": "0.3.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Recommended runtime dependencies:

```text
next
react
react-dom
@tanstack/react-query
react-hook-form
zod
@hookform/resolvers
lucide-react
date-fns
clsx
tailwind-merge
class-variance-authority
@radix-ui/react-dialog
@radix-ui/react-select
@radix-ui/react-tabs
@radix-ui/react-tooltip
@radix-ui/react-popover
```

Add only when the relevant feature starts:

```text
@clerk/nextjs          # hosted Clerk auth
recharts               # retrospective analytics charts
@tanstack/react-table  # advanced table sorting/column state
```

Recommended dev dependencies:

```text
typescript
eslint
tailwindcss
postcss
autoprefixer
vitest
@testing-library/react
@testing-library/jest-dom
@testing-library/user-event
@playwright/test
```

Adjust scripts if the selected Next.js version no longer supports `next lint`;
the important part is that root `pnpm lint`, `pnpm build`, and
`pnpm typecheck` can include the web package through Turbo.

Done when:

- `pnpm --filter @lunaperception/web typecheck` can run.
- `pnpm --filter @lunaperception/web build` can run after initial app files
  exist.

### WEB-0202 - Add TypeScript and Next config

Create:

```text
apps/web/tsconfig.json
apps/web/next.config.ts
apps/web/next-env.d.ts
```

Rules:

- Use strict TypeScript.
- Do not import backend source files directly from `apps/api/src` until a shared
  contract package or generated client exists.
- Use path alias `@/*` for `apps/web/src/*`.

Done when:

- TypeScript resolves app routes and `src` imports.
- No backend internals leak into frontend imports.

### WEB-0203 - Add app directory

Create:

```text
apps/web/app/layout.tsx
apps/web/app/page.tsx
apps/web/app/globals.css
apps/web/app/workbench/page.tsx
```

Initial behavior:

- `/` redirects to `/workbench` or renders the workbench directly.
- No marketing hero.
- No placeholder "coming soon" as the final state after this phase.

Done when:

- Browser opens a workstation shell.
- Build passes.

### WEB-0204 - Add base source structure

Create:

```text
apps/web/app/(auth)/
apps/web/app/(workstation)/
apps/web/src/api/
apps/web/src/app/
apps/web/src/auth/
apps/web/src/components/ui/
apps/web/src/components/research/
apps/web/src/features/
apps/web/src/lib/
apps/web/src/styles/
apps/web/src/test/
```

Recommended feature folders:

```text
apps/web/src/features/workbench/
apps/web/src/features/research-runs/
apps/web/src/features/theses/
apps/web/src/features/signals/
apps/web/src/features/alerts/
apps/web/src/features/watchlists/
apps/web/src/features/briefs/
apps/web/src/features/retrospective/
apps/web/src/features/operations/
apps/web/src/features/settings/
```

Done when:

- Route files stay thin and only bind route params to feature pages.
- Fetching, formatting, auth, and UI logic live in source folders.
- Auth code lives under `src/auth`, not scattered through pages.
- API paths live only under `src/api`.

## 8. Phase 3 - API Client, Query, And Auth Foundation

Goal: all screens consume the API through one typed layer.

### WEB-0301 - Create frontend API types

Create `apps/web/src/api/types.ts`.

Initial source:

- Mirror interfaces from `apps/api/src/contracts/frontend-contract.ts`.
- Add request types for:
  - `CreateResearchRunRequest`
  - `RecordThesisDecisionRequest`
  - `RecordThesisReviewRequest`
  - `AddWatchlistItemRequest`

Rule:

- Keep type names aligned with the API contract.
- Add a TODO to replace manual mirror with generated OpenAPI/shared contract.

Done when:

- No screen uses `any` for API responses.
- DTO drift is easy to detect during review.

### WEB-0302 - Create API client primitive

Create `apps/web/src/api/client.ts`.

Responsibilities:

- Resolve `baseUrl` from `NEXT_PUBLIC_API_BASE_URL`.
- In local mode, attach `x-user-id`.
- In local mode, attach `x-workspace-id`.
- In hosted mode, attach `Authorization: Bearer <jwt>`.
- Serialize query strings.
- Parse JSON.
- Convert non-2xx responses into one `ApiError` shape.
- Preserve status code, route, response body, and request ID if present.

Recommended shape:

```ts
export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};
```

Done when:

- Components never call `fetch` directly.
- Every API error can be displayed with a useful message and debug details.
- Switching from local headers to hosted bearer tokens changes only auth/client
  plumbing, not feature components.

### WEB-0303 - Create endpoint modules

Create:

```text
apps/web/src/api/research-runs.ts
apps/web/src/api/theses.ts
apps/web/src/api/signals.ts
apps/web/src/api/watchlists.ts
apps/web/src/api/briefs.ts
apps/web/src/api/alerts.ts
```

Required functions:

- `createResearchRun(request)`
- `getResearchRun(id)`
- `getResearchRunEvents(id)`
- `getResearchRunSnapshots(id)`
- `getResearchRunDebate(id)`
- `getResearchRunWorkspace(id)`
- `getJournalRunWorkspace(id)`
- `listTheses(params)`
- `getThesis(id)`
- `getThesisScenarios(id)`
- `recordThesisDecision(id, request)`
- `recordThesisReview(id, request)`
- `listSignals(params)`
- `listWatchlists(params)`
- `addWatchlistItem(id, request)`
- `listDailyBriefs(params)`
- `listAlerts(params)`
- `markAlertRead(id)`

Done when:

- Endpoint paths appear in exactly one module.
- Query params are typed.

### WEB-0304 - Add TanStack Query provider

Create:

```text
apps/web/src/app/providers.tsx
apps/web/src/api/query-keys.ts
```

Query key policy:

```text
researchRun(id)
researchRunEvents(id)
researchRunWorkspace(id)
theses(filters)
thesis(id)
thesisScenarios(id)
signals(filters)
watchlists(filters)
dailyBriefs(filters)
alerts(filters)
```

Done when:

- Server state is not duplicated into a global client store.
- Active run polling can be managed with query options.

### WEB-0305 - Add auth/workspace provider

Create:

```text
apps/web/src/auth/auth-provider.tsx
apps/web/src/auth/auth-types.ts
apps/web/src/auth/local-auth.ts
apps/web/src/auth/hosted-auth.ts
apps/web/src/auth/require-auth.tsx
apps/web/src/auth/workspace-switcher.tsx
apps/web/src/lib/env.ts
```

Responsibilities:

- Provide current `userId`.
- Provide current `workspaceId`.
- Provide current auth mode: `local`, `clerk`, `auth0`, or `better-auth`.
- Provide a placeholder `getApiToken()` function for future hosted mode.
- Provide a `getLocalHeaders()` function for local mode.
- Use local defaults in development.
- Expose a small dev-only switcher later.
- Hide header-based auth behind the API client.
- Keep hosted token retrieval behind the same interface later, but do not
  implement a hosted provider in the current local MVP.

Local mode behavior:

```text
auth mode: local
identity source: NEXT_PUBLIC_LOCAL_USER_ID
workspace source: NEXT_PUBLIC_LOCAL_WORKSPACE_ID
transport: x-user-id and x-workspace-id
```

Hosted Clerk behavior:

```text
auth mode: clerk
identity source: Clerk user/session
workspace source: active Clerk organization mapped to local Workspace
transport: Authorization bearer token
```

Do not implement hosted Clerk behavior in the first local MVP. Keep this as the
interface shape so the later hosted-auth work is additive.

Route protection:

- Local mode can render the app directly.
- Hosted mode later protects `(workstation)` routes and redirects
  unauthenticated users to `(auth)/sign-in`.
- API still enforces authorization; Next.js route protection is not enough.

Done when:

- No component imports `NEXT_PUBLIC_LOCAL_USER_ID` directly.
- Hosted auth can later replace this provider.
- Feature code does not know whether auth is local headers or JWT.

## 9. Phase 4 - UI System And App Shell

Goal: build a dense research workstation shell before feature screens.

### WEB-0401 - Define visual tokens

In `apps/web/app/globals.css`, define:

- Background.
- Surface.
- Muted surface.
- Border.
- Foreground.
- Muted foreground.
- Accent/info.
- Constructive.
- Risk.
- Warning/stale.
- Degraded.

Rules:

- Avoid one-color dashboards.
- Avoid marketing gradients.
- Avoid large rounded cards.
- Use 8px radius or less unless a component has a clear reason.
- Color cannot be the only indicator; pair with label/icon.

Done when:

- The app reads as a professional research tool.
- Text is readable in compact tables and panels.

### WEB-0402 - Create reusable primitives

Create:

```text
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/input.tsx
apps/web/src/components/ui/select.tsx
apps/web/src/components/ui/tabs.tsx
apps/web/src/components/ui/table.tsx
apps/web/src/components/ui/dialog.tsx
apps/web/src/components/ui/drawer.tsx
apps/web/src/components/ui/empty-state.tsx
apps/web/src/components/ui/error-state.tsx
apps/web/src/components/ui/loading-state.tsx
apps/web/src/components/ui/skeleton.tsx
```

Rules:

- Use native semantics where possible.
- Buttons must have clear command text or known icons with accessible labels.
- Forms must have labels.
- Dialogs/drawers must trap focus if implemented.

Done when:

- Feature screens do not hand-roll basic controls repeatedly.

### WEB-0403 - Create research-specific primitives

Create:

```text
apps/web/src/components/research/confidence-meter.tsx
apps/web/src/components/research/direction-badge.tsx
apps/web/src/components/research/freshness-badge.tsx
apps/web/src/components/research/status-pill.tsx
apps/web/src/components/research/degraded-banner.tsx
apps/web/src/components/research/evidence-list.tsx
apps/web/src/components/research/id-chip.tsx
apps/web/src/components/research/json-drawer.tsx
apps/web/src/components/research/source-timestamp.tsx
apps/web/src/components/research/invalidation-callout.tsx
apps/web/src/components/research/monitor-next-list.tsx
```

Done when:

- Thesis, run, signal, and alert screens share provenance/freshness UI.
- Users can always copy IDs from research artifacts.

### WEB-0404 - Build persistent app shell

Create:

```text
apps/web/src/app/app-shell.tsx
apps/web/src/app/sidebar-nav.tsx
apps/web/src/app/top-command-strip.tsx
```

Navigation:

```text
Workbench
Research
Journal
Theses
Signals
Watchlists
Briefs
Retrospective
Operations
Settings
```

Top command strip:

- Symbol quick input.
- Spot/perp segmented control.
- Date/as-of selector.
- Config profile selector.
- Run research button.
- Workspace/user chip in local mode.

Done when:

- All routes share the same shell.
- Mobile collapses sidebar without hiding primary content.

## 10. Phase 5 - Workbench

Goal: make the first screen useful before all deep screens are complete.

### WEB-0501 - Route and layout

Create `apps/web/app/workbench/page.tsx`.

Panels:

- Daily brief summary.
- Unread alerts.
- Active thesis inbox.
- Signal board.
- Watchlist overview.
- Recent runs, once `GET /research-runs` exists.

Initial fallback:

- If run list endpoint is not available, omit recent runs or show only links
  from briefs/theses. Do not fake data.

Done when:

- Workbench loads with real API calls.
- Empty state explains how to run first research job.

### WEB-0502 - Brief summary panel

Data:

- `GET /briefs/daily?limit=1`

UI:

- Title.
- Date.
- Watchlist name.
- Summary.
- Key points.
- Linked thesis IDs.
- Linked signal IDs.
- Previous brief link if available.

Done when:

- Missing brief is shown as empty state, not error.
- Linked IDs navigate when routes exist.

### WEB-0503 - Unread alerts panel

Data:

- `GET /alerts?unread=true&limit=10`

UI:

- Alert type.
- Symbol.
- Message.
- Created time.
- Read/unread state.
- Link to thesis if `thesis_id` exists.
- `Mark read` action.

Done when:

- `POST /alerts/:id/read` updates the panel via query invalidation.

### WEB-0504 - Active thesis inbox panel

Data:

- `GET /theses?limit=20`

UI:

- Symbol.
- Direction.
- Setup type.
- Confidence.
- Invalidation.
- Degraded/stale badges.
- Created time.
- Link to thesis detail.

Done when:

- The panel exposes missing/stale data instead of hiding it.

### WEB-0505 - Signal board panel

Data:

- `GET /signals?limit=50`

UI:

- Group by symbol if enough data is available.
- Show bullish/bearish/neutral counts.
- Show stale/unknown freshness count when derivable.
- Link to signal explorer with filter.

Done when:

- The board helps users decide what to inspect next without implying trades.

## 11. Phase 6 - Research Run Launcher

Goal: users can start research from the web.

### WEB-0601 - Create route

Create:

```text
apps/web/app/research/new/page.tsx
apps/web/src/features/research-runs/research-run-form.tsx
```

Form fields:

- Symbol.
- Asset class, default `crypto`.
- Market type: `spot` or `perp`.
- Analysis date.
- Analysts multi-select.
- Config profile.
- Optional run ID in advanced section.

Default analysts:

```text
market
news
social
onchain
quant
risk
```

Done when:

- Validation prevents blank symbol/workspace/analyst values.
- Submitted payload matches `CreateResearchRunDto`.

### WEB-0602 - Add profile handling

Initial hardcoded profiles:

```text
default
fast
deep
low-cost
```

Later replace with:

```text
GET /settings/profiles
GET /settings/config-health
```

Done when:

- Hardcoded profiles are isolated in one config file.
- Missing backend profile endpoint does not block MVP.

### WEB-0603 - Submit run

Mutation:

- `POST /research-runs`

Success behavior:

- Show queued/submitted/completed status.
- Store returned `run_id`.
- Navigate to `/research/runs/:id`.

Error behavior:

- Validation errors map to form fields where possible.
- Workspace/auth errors show permission state.
- Queue/provider errors show retry guidance.

Done when:

- A user can launch a run without using the CLI.

## 12. Phase 7 - Research Run Workspace

Goal: inspect a single run from queue to final thesis.

### WEB-0701 - Create route

Create:

```text
apps/web/app/research/runs/[id]/page.tsx
apps/web/src/features/research-runs/research-run-workspace.tsx
```

Primary data:

- `GET /research-runs/:id/workspace`

Fallback data if composite route fails:

- `GET /research-runs/:id`
- `GET /research-runs/:id/events`
- `GET /research-runs/:id/snapshots`
- `GET /research-runs/:id/debate`

Done when:

- One run ID opens a complete workspace.
- Partial data is shown as partial/degraded, not as a blank failure.

### WEB-0702 - Add polling hook

Create:

```text
apps/web/src/features/research-runs/use-run-progress.ts
```

Rules:

- Poll every 3-5 seconds while status is active.
- Stop polling on terminal statuses.
- Refetch on window focus if active.
- Poll events separately if the composite payload is too heavy.

Terminal status candidates:

```text
completed
failed
cancelled
degraded
```

Done when:

- Active run progress updates without page refresh.
- Polling does not continue forever after terminal state.

### WEB-0703 - Header panel

Show:

- Symbol.
- Asset class.
- Market type.
- Timeframe.
- Status.
- Started/completed timestamps.
- Thesis ID.
- Decision ID.
- Snapshot IDs.
- Degradation reasons.
- Missing core data.
- Missing optional data.

Done when:

- A degraded run is visually distinct from a failed run.

### WEB-0704 - Timeline panel

Data:

- `events` from workspace payload.

Show:

- Event type.
- Created time.
- Message.
- Linked thesis ID.
- JSON drawer for payload.

Done when:

- Timeline supports queued/running/completed/failure narratives.

### WEB-0705 - Market snapshot panel

Show:

- Current price.
- Source.
- Source timestamp.
- Captured timestamp.
- Freshness state.
- Raw payload drawer.

Done when:

- Users can tell whether market data is fresh, stale, or missing.

### WEB-0706 - Signal snapshot panel

Show:

- Signal count.
- Bullish count.
- Bearish count.
- Neutral count.
- Stale count.
- Unknown freshness count.
- Composite signal ID.
- Raw payload drawer.

Done when:

- Signal quality is visible before thesis text.

### WEB-0707 - Agent debate panel

Show:

- Consensus stance.
- Conflict level.
- Agent opinions.
- Agent role.
- Stance.
- Confidence.
- Opinion payload drawer.

Done when:

- Bull, bear, risk, and uncertainty arguments are visible.

### WEB-0708 - Thesis result shortcut

If `thesis` exists:

- Show thesis summary.
- Show direction/setup/confidence.
- Show invalidation.
- Link to `/theses/:id`.

If `thesis` missing:

- Show pending/degraded/missing state based on run status.

Done when:

- Users can move from run inspection to thesis lifecycle.

## 13. Phase 8 - Thesis Library

Goal: turn AI outputs into a browsable research memory.

### WEB-0801 - Create route

Create:

```text
apps/web/app/theses/page.tsx
apps/web/src/features/theses/thesis-library.tsx
```

Data:

- `GET /theses?limit=50`

Done when:

- Theses render in a dense, filterable inbox.

### WEB-0802 - Add filters

Client-side first:

- Symbol.
- Direction.
- Setup type.
- Minimum confidence.
- Degraded only.
- Missing data only.
- Created date range.

Backend later:

- Add API query params if list grows large.
- Add cursor pagination.

Done when:

- Client filters do not change the backend contract prematurely.
- Empty filtered state is clear.

### WEB-0803 - Add table/list columns

Columns:

- Created.
- Symbol.
- Direction.
- Setup type.
- Confidence.
- Rating.
- Entry zone.
- Invalidation.
- Target zones.
- Missing/stale count.
- Monitor next count.
- Linked run ID.

Done when:

- The library is useful without opening every thesis.

### WEB-0804 - Add saved views

Local UI state:

- All theses.
- Needs review.
- Degraded.
- High conflict.
- Watched.
- Recently created.

Backend later:

- Persist user views only after real auth exists.

Done when:

- The user can triage research artifacts quickly.

## 14. Phase 9 - Thesis Detail, Decision, And Review

Goal: close the journal feedback loop.

### WEB-0901 - Create route

Create:

```text
apps/web/app/theses/[id]/page.tsx
apps/web/src/features/theses/thesis-detail.tsx
```

Data:

- `GET /theses/:id`
- `GET /theses/:id/scenarios`

Done when:

- A thesis opens with summary, evidence, scenarios, decision, and review
  sections.

### WEB-0902 - Summary and trade-plan panels

Show:

- Rating.
- Direction.
- Confidence.
- Market type.
- Setup type.
- Action summary.
- Entry zone.
- Invalidation level.
- Target zones.
- Upside catalyst.
- Key reasons.
- Risks.
- Spot notes.
- Perp notes.

Done when:

- Invalidation is visible without scrolling on desktop.
- Missing/degraded information is visible near summary.

### WEB-0903 - Evidence panel

Show:

- Supporting signal IDs.
- Contradicting signal IDs.
- Stale or missing data.
- Degradation reasons.
- Monitor-next items.

Behavior:

- Signal IDs link to `/signals` filtered by ID if supported later.
- Until signal-by-ID exists, keep copyable ID chips.

Done when:

- The user can see why the thesis exists and why it may be wrong.

### WEB-0904 - Scenario radar

Data:

- `GET /theses/:id/scenarios`

Show each scenario:

- Probability band.
- Condition.
- Expected behavior.
- Suggested user action.
- Payload drawer.

Done when:

- Scenarios are conditional research branches, not trade commands.

### WEB-0905 - Decision form

Mutation:

- `POST /theses/:id/decision`

Actions:

```text
watched
accepted
rejected
ignored
needs_more_research
```

Fields:

- Action.
- Notes.

Done when:

- Submit disables while pending.
- Success refetches thesis detail and thesis list.
- Decision copy says `Record decision`, not `Execute`.

### WEB-0906 - Outcome review form

Mutation:

- `POST /theses/:id/review`

Results:

```text
worked
failed
mixed
invalidated
expired
unknown
```

Fields:

- Result.
- Notes/lessons.

Backend note:

- Current DTO accepts `result` and `notes`.
- Contract response includes `invalidated`; if UI needs explicit invalidated
  boolean input, extend the DTO deliberately.

Done when:

- A user can review a thesis later and capture lessons.

### WEB-0907 - Lifecycle timeline

Show:

- Thesis created.
- Decision recorded.
- Alerts linked to thesis.
- Outcome reviewed.
- Future evaluation events when endpoint exists.

Done when:

- The thesis feels like a living object, not a one-off report.

## 15. Phase 10 - Signal Explorer

Goal: make deterministic evidence inspectable independent of AI prose.

### WEB-1001 - Create route

Create:

```text
apps/web/app/signals/page.tsx
apps/web/src/features/signals/signal-explorer.tsx
```

Data:

- `GET /signals?symbol=&limit=`

Done when:

- Signals render in a dense table.

### WEB-1002 - Add filters

Initial filters:

- Symbol.
- Direction.
- Signal type.
- Minimum confidence.
- Source.
- Freshness derived from timestamp if possible.

Backend later:

- Add API params for direction, type, source, freshness, cursor.

Done when:

- Users can isolate signals that support or contradict a thesis.

### WEB-1003 - Add signal detail drawer

Show:

- Signal ID.
- Symbol.
- Signal type.
- Direction.
- Confidence.
- Observed at.
- Source.
- Source timestamp.
- Summary.
- Payload when endpoint exposes it.

Backend note:

- Current `SignalResponse` does not expose raw payload.
- Add payload later if the product needs full signal provenance in the UI.

Done when:

- Signal provenance is visible enough for MVP.

### WEB-1004 - Build "why this signal exists" panel

For each signal, answer:

- What source produced it?
- When was the source data observed?
- How fresh is it?
- What direction does it imply?
- How confident is it?
- What thesis/run references it, if links exist?

Done when:

- Signals are audit artifacts, not just colored rows.

## 16. Phase 11 - Alerts Inbox

Goal: make monitoring actionable without creating trade-command behavior.

### WEB-1101 - Create route

Create:

```text
apps/web/app/alerts/page.tsx
apps/web/src/features/alerts/alerts-inbox.tsx
```

Data:

- `GET /alerts?symbol=&thesis_id=&unread=&limit=`

Done when:

- Alerts render with unread/read state.

### WEB-1102 - Alert list columns

Columns:

- Read state.
- Created.
- Alert type.
- Symbol.
- Message.
- Thesis ID.
- Watchlist item ID.
- Trigger key.

Done when:

- Alert row explains what changed and what to inspect next.

### WEB-1103 - Mark read action

Mutation:

- `POST /alerts/:id/read`

Behavior:

- Optimistically mark read.
- Refetch alerts on success.
- Roll back on failure.

Done when:

- Workbench unread count updates after mark-read.

### WEB-1104 - Alert detail drawer

Show:

- Message.
- Trigger key.
- Payload JSON.
- Link to thesis.
- Link to watchlist item when route exists.

Done when:

- Alert detail says why it fired.

## 17. Phase 12 - Watchlists

Goal: support the user monitoring loop.

### WEB-1201 - Create route

Create:

```text
apps/web/app/watchlists/page.tsx
apps/web/src/features/watchlists/watchlists-page.tsx
```

Initial data:

- `GET /watchlists?limit=`

Done when:

- Existing watchlists render.

### WEB-1202 - Add item form

Mutation:

- `POST /watchlists/:id/items`

Supported item types:

```text
symbol
thesis
setup_type
```

Fields:

- Item type.
- Symbol.
- Thesis ID.
- Setup type.

Validation:

- Symbol required for symbol items.
- Thesis ID required for thesis items.
- Setup type required for setup-type items.

Done when:

- Users can add monitored items through the UI.

### WEB-1203 - Backend watchlist management additions

Add these before calling watchlists complete:

```text
POST /watchlists
GET /watchlists/:id
GET /watchlists/:id/items
PATCH /watchlists/:id
DELETE /watchlists/:id/items/:itemId
POST /watchlists/:id/check
GET /watchlists/:id/brief
```

Done when:

- Users can create, rename, enable/disable, inspect, and remove watchlist items.
- Explicit monitoring checks are possible without waiting for scheduled jobs.

### WEB-1204 - Watchlist detail view

Create later:

```text
apps/web/app/watchlists/[id]/page.tsx
```

Show:

- Watchlist metadata.
- Items grouped by type.
- Recent alerts.
- Related theses.
- Latest brief.
- Manual check action.

Done when:

- A watchlist becomes a daily research object, not just a list of symbols.

## 18. Phase 13 - Daily Briefs

Goal: make daily research habit-forming.

### WEB-1301 - Create route

Create:

```text
apps/web/app/briefs/daily/page.tsx
apps/web/src/features/briefs/daily-briefs-page.tsx
```

Data:

- `GET /briefs/daily?date=&limit=`

Done when:

- Users can read the latest brief and browse recent briefs.

### WEB-1302 - Brief list

Show:

- Brief date.
- Watchlist name.
- Title.
- Created time.
- Previous brief ID.
- Summary excerpt.
- Linked thesis count.
- Linked signal count.

Done when:

- Brief archive is scannable.

### WEB-1303 - Brief detail

Create route:

```text
apps/web/app/briefs/daily/[id]/page.tsx
```

Backend note:

- Current API lists briefs but does not expose `GET /briefs/:id`.
- Until route exists, show detail from the list payload or use query state.

Show:

- Title.
- Summary.
- Key points.
- Thesis IDs.
- Signal IDs.
- Previous brief link.
- Raw payload if endpoint later exposes it.

Done when:

- Daily brief references active theses and evidence.

### WEB-1304 - Brief memory

Backend later:

- Expand brief payload to include:
  - What changed since previous brief.
  - Thesis confidence deltas.
  - New contradictions.
  - New stale/missing data.
  - New scenario activations.

Done when:

- The brief answers "what changed since yesterday?".

## 19. Phase 14 - Settings And Operations

Goal: expose trust, configuration, and local mode state.

### WEB-1401 - Create settings route

Create:

```text
apps/web/app/settings/page.tsx
apps/web/src/features/settings/settings-page.tsx
```

Initial UI:

- API base URL.
- Local user ID.
- Local workspace ID.
- Auth mode: local headers.
- Data mode warning: local/private beta.
- Config profile defaults.

Done when:

- Users understand why local headers are being used.

### WEB-1402 - Create operations route

Create:

```text
apps/web/app/operations/page.tsx
apps/web/src/features/settings/operations-page.tsx
```

Initial UI:

- Placeholder explaining missing operations endpoints.
- No fake provider health.

Backend additions:

```text
GET /operations/provider-health
GET /operations/llm-calls
GET /operations/data-freshness
GET /operations/queue
GET /settings/config-health
GET /settings/profiles
```

Done when:

- Once endpoints exist, operations can show provider/model/data quality.

### WEB-1403 - Secret safety rules

UI rules:

- Never show raw API keys.
- Show only configured/missing/invalid.
- Show provider names, model names, and health states.
- Do not send secrets to `NEXT_PUBLIC_*` env vars.

Done when:

- No secret can be bundled into frontend code.

## 20. Phase 15 - Journal Route

Goal: make the "research OS" memory explicit.

### WEB-1501 - Create run journal route

Create:

```text
apps/web/app/journal/runs/[id]/page.tsx
apps/web/src/features/research-runs/journal-run-workspace.tsx
```

Data:

- `GET /journal/runs/:id/workspace`

Reuse:

- Research run header.
- Timeline.
- Snapshots.
- Debate.
- Thesis shortcut.
- Scenario radar.

Done when:

- Journal route can be linked from theses, briefs, and alerts.

### WEB-1502 - Add journal search later

Backend additions:

```text
GET /journal/search
GET /journal/theses/:id/links
POST /journal/notes
PATCH /journal/notes/:id
DELETE /journal/notes/:id
```

Done when:

- Users can search notes, theses, run events, evidence, and lessons.

## 21. Phase 16 - Differentiator Layer

Goal: build features that make this a research OS instead of a generic AI
dashboard.

### WEB-1601 - Contradiction map

Create:

```text
apps/web/src/components/research/contradiction-map.tsx
```

Inputs:

- Supporting signal IDs.
- Contradicting signal IDs.
- Risks.
- Missing/stale data.
- Debate conflict level.

UI:

- Bull case column.
- Bear/risk case column.
- Missing data column.
- Conflict score/label.
- Explanation of what reduced confidence.

Done when:

- The user sees both sides before recording a decision.

### WEB-1602 - Run diff

Backend addition:

```text
POST /compare/runs
```

Request:

```json
{
  "left_run_id": "run_a",
  "right_run_id": "run_b"
}
```

UI route:

```text
apps/web/app/compare/runs/page.tsx
```

Compare:

- Consensus stance.
- Conflict level.
- Confidence.
- Snapshot freshness.
- New supporting evidence.
- New contradictions.
- Missing data.
- Thesis changes.
- Scenario changes.

Done when:

- Users can answer "what changed and why?" across two runs.

### WEB-1603 - Thesis diff

Backend addition:

```text
POST /compare/theses
```

Compare:

- Direction.
- Setup type.
- Confidence.
- Entry zone.
- Invalidation.
- Target zones.
- Supporting signals.
- Contradicting signals.
- Monitor-next items.

Done when:

- Re-running research creates a meaningful before/after narrative.

### WEB-1604 - Scenario radar improvements

Add:

- Scenario status: inactive, watching, active, invalidated.
- Trigger evidence.
- Suggested review action.
- Linked alerts.

Backend additions:

```text
PATCH /scenarios/:id/status
GET /theses/:id/scenario-events
```

Done when:

- Scenario planning becomes monitorable over time.

## 22. Phase 17 - Retrospective And Reliability Analytics

Goal: measure research quality without fake trading metrics.

### WEB-1701 - Create route

Create:

```text
apps/web/app/retrospective/page.tsx
apps/web/src/features/retrospective/retrospective-page.tsx
```

Backend additions:

```text
GET /retrospective/evaluations
GET /retrospective/reliability
GET /retrospective/agent-calibration
GET /retrospective/confidence-calibration
GET /retrospective/setup-quality
```

Done when:

- Route is empty-state ready until endpoints exist.

### WEB-1702 - Metrics to show

Show only metrics the data can support:

- Thesis hit rate.
- Invalidation rate.
- Average MFE/MAE if evaluation data exists.
- Time to target.
- Time to invalidation.
- Signal reliability.
- Agent calibration.
- Confidence calibration.
- Setup type quality.
- Lessons from outcome reviews.

Do not show:

- Sharpe.
- Alpha.
- Annualized return.
- Account PnL.
- Broker-style win rate.

Done when:

- The analytics page improves decision quality without overclaiming.

### WEB-1703 - Evaluation drilldown

Each evaluated thesis should show:

- Thesis ID.
- Symbol.
- Direction.
- Setup type.
- Original confidence.
- Original invalidation.
- Target zones.
- Evaluation result.
- Lessons.
- Links to run, thesis, signals, and review.

Done when:

- Users can understand which ideas worked and why.

## 23. Phase 18 - Backend Production Hardening For Web

Goal: make the API safe and stable enough for serious use.

### API-1801 - Standard error envelope

Implement consistent error shape:

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

Required codes:

```text
validation_failed
workspace_forbidden
not_found
run_already_exists
queue_unavailable
provider_unavailable
engine_failed
data_degraded
rate_limited
internal_error
```

Done when:

- Web can map error codes to stable UI states.

### API-1802 - Research run list endpoint

Add:

```text
GET /research-runs?symbol=&status=&limit=&cursor=
```

Return:

- `ResearchRunResponse[]`.
- Cursor metadata once pagination exists.

Done when:

- Workbench and Research pages can show recent runs.

### API-1803 - Job status endpoint

Add:

```text
GET /jobs/:id
```

Return:

- Job ID.
- Backend: inline, memory, bullmq.
- Status.
- Run ID.
- Created/started/completed timestamps.
- Error code/message.
- Retry count if applicable.

Done when:

- Web can show queue state even before run artifacts are persisted.

### API-1804 - Watchlist CRUD

Add:

```text
POST /watchlists
GET /watchlists/:id
GET /watchlists/:id/items
PATCH /watchlists/:id
DELETE /watchlists/:id/items/:itemId
```

Done when:

- Watchlists are manageable from the web without direct DB/CLI usage.

### API-1805 - Operations endpoints

Add:

```text
GET /operations/provider-health
GET /operations/llm-calls
GET /operations/data-freshness
GET /operations/queue
```

Done when:

- Operations page can explain provider, model, queue, and freshness problems.

### API-1806 - Settings endpoints

Add:

```text
GET /me
GET /workspaces
GET /settings/config-health
GET /settings/profiles
```

Done when:

- Web no longer hardcodes profiles/workspace details except in local dev mode.

### API-1807 - Contract generation

Choose one:

- NestJS Swagger/OpenAPI.
- A shared TypeScript contract package.
- Generated API client from OpenAPI.

Done when:

- Frontend DTOs are generated or validated in CI.
- API breaking changes fail a contract check.

## 24. Phase 19 - Hosted Production Readiness

Goal: move from local/private beta to hosted safely.

### PROD-1901 - Real auth

Do this only when moving from local/dev or private same-machine testing to
hosted private beta with external users or real multi-workspace data.

Default hosted implementation at that point:

- Clerk Organizations for user/org/session management.
- Next.js middleware protects workstation routes.
- Web retrieves a Clerk session JWT for API calls.
- NestJS API verifies the bearer token through Clerk SDK or JWKS.
- API maps provider `sub` to local `User`.
- API maps provider org ID to local `Workspace`.
- API enforces local `WorkspaceMembership` role before every route action.

Required web work:

```text
apps/web/middleware.ts
apps/web/app/(auth)/sign-in/page.tsx
apps/web/app/(auth)/sign-up/page.tsx
apps/web/src/auth/clerk-provider.tsx
apps/web/src/auth/clerk-token.ts
apps/web/src/auth/require-auth.tsx
```

Required API work:

```text
apps/api/src/auth/providers/clerk-auth-provider.ts
apps/api/src/auth/jwt/jwks-client.ts
apps/api/src/auth/jwt/jwt-verifier.ts
apps/api/src/auth/current-user.decorator.ts
apps/api/src/auth/roles.decorator.ts
apps/api/src/auth/roles.guard.ts
```

Required behavior:

- Login.
- Logout.
- Session refresh.
- Organization/workspace selection.
- Invitation flow, if enabled for hosted beta.
- Provider webhook or sync job to upsert local users/workspaces/memberships.
- Fallback local auth remains available only for development/local deployment.

Security rules:

- Hosted mode ignores `x-user-id` and `x-workspace-id`.
- Hosted mode does not trust `workspace_id` in body without matching the active
  authenticated workspace.
- No JWT or refresh token is stored in localStorage.
- No auth secret is exposed through `NEXT_PUBLIC_*`.
- API returns stable `401 unauthenticated` and `403 workspace_forbidden`
  envelopes.

Alternatives:

- Use Better Auth if the owner confirms self-hosted/no-vendor auth is required.
- Use Auth0 if the owner confirms enterprise SSO/B2B IAM is required before
  broader product work.

Done when:

- Browser cannot spoof `x-user-id` or `x-workspace-id`.
- NestJS, not the browser, derives user/workspace identity.
- Workspace isolation tests pass for all user-facing routes.
- Owner has explicitly accepted Clerk, Better Auth, or Auth0 as the hosted auth
  provider.

### PROD-1902 - Workspace RBAC

Roles:

```text
owner
analyst
reviewer
viewer
```

Rules:

- Every read/write checks workspace membership.
- Analysts can create runs and manage watchlists.
- Reviewers can record decisions and outcome reviews.
- Viewers can read only.
- Owners can manage workspace, members, settings, exports, and provider config.
- Role checks are centralized in API policies.

Done when:

- Workspace A cannot read or mutate Workspace B records in tests.
- Role tests cover owner, analyst, reviewer, and viewer for every mutation.

### PROD-1903 - BullMQ and dedicated Python workers

Production flow:

```text
NestJS API
-> BullMQ research-runs queue
-> Python worker
-> normalized Postgres writes
-> API reads persisted artifacts
```

Done when:

- API does not block on long AI research.
- Worker writes heartbeat/stage events.
- Runs end in completed, degraded, failed, cancelled, or timed_out.

### PROD-1904 - Idempotent run writes

Rules:

- `run_id` is unique per workspace.
- Worker writes can be retried safely.
- Duplicate job execution does not duplicate theses/signals/events.

Done when:

- Retry tests prove idempotency.

### PROD-1905 - Rate limits and quotas

Limit:

- Research run creation.
- Expensive compare/replay endpoints.
- Provider health checks if user-triggered.
- Alerts/notifications mutation bursts.

Done when:

- Hosted API cannot be trivially abused.

### PROD-1906 - Audit log

Record:

- User login.
- Research run creation.
- Decision.
- Review.
- Watchlist mutation.
- Settings changes.
- Workspace membership changes.

Done when:

- Team/pro workflows have traceability.

## 25. Phase 20 - Notifications

Goal: add external channels after in-app monitoring works.

### NOTIFY-2001 - In-app notifications

Already covered by alerts inbox.

Done when:

- In-app unread/read state is reliable.

### NOTIFY-2002 - Email briefs

Send:

- Daily brief.
- Weekly retrospective.
- Important thesis invalidation updates.

Rules:

- Use research language.
- Include links back to web app.
- Include unsubscribe/preferences when hosted.

Done when:

- Email adds habit value without becoming spam.

### NOTIFY-2003 - Telegram/Discord/webhook

Use cases:

- Scenario active.
- Invalidation approached.
- Watchlist condition changed.
- Provider degraded if user opts in.

Done when:

- User can configure channel and severity.
- Messages never say `buy now` or `sell now`.

## 26. Phase 21 - Export And Research Bundles

Goal: make artifacts portable and reviewable.

### EXPORT-2101 - Run bundle export

Backend:

```text
GET /exports/run-bundle/:id
```

Bundle includes:

- Run metadata.
- Events.
- Market snapshot.
- Signal snapshot.
- Signals.
- Debate.
- Agent opinions.
- Thesis.
- Scenarios.
- Decisions/reviews.
- Freshness checks.
- LLM call summary.

UI:

- Export JSON.
- Export Markdown later.
- Export PDF later.

Done when:

- A user can share or archive a full research artifact.

### EXPORT-2102 - Thesis markdown export

Include:

- Thesis summary.
- Evidence.
- Contradictions.
- Missing data.
- Scenario radar.
- Decision.
- Outcome review.

Done when:

- Research can move into external notebooks without losing provenance.

## 27. Phase 22 - Testing Strategy

Goal: keep velocity without allowing product-critical regressions.

### TEST-2201 - Frontend unit tests

Use for:

- API client error mapping.
- Query key builders.
- Date/freshness helpers.
- Confidence/freshness badge logic.
- Form validation.

Recommended tools:

- Vitest.
- React Testing Library.

Done when:

- Critical UI logic has fast tests.

### TEST-2202 - Frontend integration tests

Use mocked API responses for:

- Run launcher submit.
- Run workspace degraded state.
- Thesis decision submit.
- Thesis review submit.
- Alert mark-read.

Done when:

- Main user actions are tested without a live API.

### TEST-2203 - Browser smoke tests

Use Playwright after the app has real routes.

Smoke flows:

- Workbench loads.
- Research run form validates and submits with mocked API or local API.
- Thesis detail renders evidence and scenarios.
- Decision form submits.
- Alerts mark-read action works.

Done when:

- A contributor can catch broken layouts/navigation before release.

### TEST-2204 - API contract tests

For each route used by web:

- Happy path.
- Workspace forbidden.
- Not found.
- Validation failure.
- Empty result.
- Degraded/partial data where relevant.

Done when:

- API changes that break the web are caught before merge.

## 28. Phase 23 - Release Gates

Use these gates before calling the web MVP usable.

### GATE-2301 - Local MVP gate

Must pass:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @lunaperception/api test
```

Python gate if AI/service code changed:

```bash
cd apps/ai-service
python -m ruff check .
python -m ruff format --check .
python -m mypy tradingagents cli
python -m pytest
```

Manual flow:

- Start Postgres.
- Run API.
- Run web.
- Open workbench.
- Launch research run.
- Open run workspace.
- Open thesis detail.
- Record decision.
- Record review.
- Open signals.
- Open alerts.
- Mark alert read.
- Open watchlists.
- Open daily briefs.

Done when:

- The loop works with real local data.

### GATE-2302 - Private beta gate

Must have:

- Error envelope.
- Run/job status clarity.
- Workspace access tests.
- Provider failure/degraded states.
- No secret leakage.
- Basic browser smoke tests.
- Clear local/private-beta warning.
- No execution/trading-command copy.

Done when:

- A technical user can run the workstation without hand-holding.

### GATE-2303 - Hosted beta gate

Must have:

- Real auth.
- Real workspace RBAC.
- BullMQ production queue.
- Dedicated workers.
- Postgres persistence path.
- Rate limiting.
- Audit log.
- Backups.
- Monitoring.
- Incident runbooks.
- Notification preferences if external notifications exist.

Done when:

- The app can hold multiple workspaces without trusting client-provided IDs.

## 29. Recommended Build Order Summary

Build exactly in this order unless a task is blocked by an explicit dependency:

1. Lock research-workstation product boundary.
2. Verify API and database local setup.
3. Scaffold `apps/web`.
4. Add app shell and visual primitives.
5. Add typed API client and auth/workspace provider.
6. Build Workbench with briefs, alerts, theses, signals, watchlists.
7. Build Research Run Launcher.
8. Build Research Run Workspace.
9. Add run/job status backend endpoint if progress is unclear.
10. Build Thesis Library.
11. Build Thesis Detail.
12. Build Decision form.
13. Build Outcome Review form.
14. Build Signal Explorer.
15. Build Alerts Inbox.
16. Build Watchlist page with current endpoints.
17. Add missing watchlist CRUD endpoints.
18. Build Daily Brief archive.
19. Build Settings local-mode page.
20. Build Operations page after provider/freshness/LLM endpoints exist.
21. Build Journal run workspace.
22. Build Contradiction Map.
23. Build Run Diff and Thesis Diff after compare endpoints exist.
24. Build Retrospective analytics after evaluation/reliability endpoints exist.
25. Add export/run-bundle workflow.
26. Harden API error envelope and contract generation.
27. Replace local/header auth before hosted beta.
28. Add RBAC, rate limits, audit log, queue/worker hardening.
29. Add email/Telegram/Discord/webhook notifications.
30. Only then consider billing and broader SaaS packaging.

## 30. What Not To Build Yet

Do not prioritize:

- Live order execution.
- Broker exchange order routing.
- Futures/leverage automation.
- Auto position management.
- Fake backtesting dashboards.
- Fake PnL, Sharpe, alpha, or annualized returns.
- Generic multi-asset screener.
- Marketing landing page before the logged-in workstation.
- Cloud multi-team features before local journal/thesis loop works.
- Billing before daily workflow value is clear.

## 31. Final MVP Definition

The web MVP is complete when a user can:

1. Open the Workbench and see real briefs, alerts, theses, signals, and
   watchlists.
2. Launch a research run from the browser.
3. Inspect run status, timeline, snapshots, debate, and generated thesis.
4. Open a thesis and understand evidence, contradictions, missing data,
   scenarios, invalidation, and monitor-next items.
5. Record a user decision.
6. Later record an outcome review.
7. Inspect signals independently.
8. Read and mark alerts.
9. Maintain a basic watchlist.
10. Read daily briefs.
11. Understand when data/provider/model quality is degraded.

If those eleven behaviors work with real local data, the app is a real
research workstation MVP. Everything after that should improve reliability,
memory, differentiation, and hosted readiness.
