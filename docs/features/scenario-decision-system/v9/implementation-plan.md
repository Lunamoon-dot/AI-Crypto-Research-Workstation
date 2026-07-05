# Platform Spot Purge And Perp-Only Hardening V9 Implementation Plan

Status: design-ready, execute only after V8.2-V8.4 stabilize the trade surface
Last updated: 2026-07-06

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove or quarantine spot-first assumptions from the platform layer once the trade-lab product surface is proven stable and perp-only semantics are trusted.

**Architecture:** V9 is a platform migration and contract-hardening release. It removes spot defaults and spot fallback behavior from configuration, launch DTOs, market-data normalization, and selected workspace/platform surfaces. Legacy spot data is either migrated, archived, or explicitly hidden from perp-only product surfaces. This phase intentionally happens after the product boundary and lifecycle semantics are already correct.

**Tech Stack:** AI-service config/schema layer, NestJS API contracts and services, market-data provider layer, React/Vite launch/workspace UI, Postgres migrations, Node test runner, Python tests where needed.

---

## Product Scope

V9 answers:

```text
Can the platform still silently fall back to spot?
Can a workspace, run, or market-data request still default to spot?
Can market-data providers still route to spot-only endpoints by accident?
Can legacy spot data be contained without confusing the new perp-only product?
```

V9 must not create:

```text
live exchange execution
broker credential support
portfolio margin accounting
opportunity semantics redesign
new paper execution logic unrelated to spot removal
```

## Problem Statement

Even after the trade-lab boundary is locked, the platform still contains many
spot defaults and branches:

- AI-service config defaults
- API DTO defaults
- web launch/workspace defaults
- market-data normalization and provider routing
- generated OpenAPI enums and client types
- legacy records with `market_type = 'spot'`

Those are acceptable during product stabilization, but they remain a long-term
risk if the platform should truly become perp-first.

## Preconditions

Do not start V9 until:

- V8.2 trade-lab boundary is live
- V8.3 opportunity semantics are stable
- V8.4 auto outcome/settlement is stable
- a small operator group has validated the perp-only trade surface

## Goals

1. Remove platform defaults that silently choose `spot`.
2. Remove platform fallback behavior that normalizes invalid market types to `spot`.
3. Tighten perp-only contracts where product scope now requires them.
4. Either migrate or explicitly quarantine legacy spot artifacts.
5. Keep market-data provider behavior deterministic and explicit.

## Non-Goals

1. Do not begin this migration before product semantics are stable.
2. Do not rewrite unrelated research or continuity features without evidence.
3. Do not assume every historical spot artifact should be rewritten in place.

## High-Risk Areas

- [apps/ai-service/config/default.toml](/C:/Users/dell/LunaCrypto/apps/ai-service/config/default.toml)
- [apps/ai-service/luna_workstation/default_config.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/default_config.py)
- [apps/ai-service/luna_workstation/config/schema.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/config/schema.py)
- [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)
- [apps/api/src/workspaces/workspaces.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/workspaces/workspaces.service.ts)
- [apps/api/src/contracts/openapi.generated.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/openapi.generated.ts)
- [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- [apps/web/src/components/navigation/WorkspaceSwitcher.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/components/navigation/WorkspaceSwitcher.tsx)

## Migration Strategy

V9 should be executed in four steps:

```text
1. Remove default/fallback-to-spot behavior
2. Tighten DTO/schema contracts
3. Remove or quarantine spot provider/UI branches
4. Migrate or archive legacy spot data
```

Each step should ship with focused tests and rollback visibility.

## File Plan

### AI-service/config layer

- Modify: [apps/ai-service/config/default.toml](/C:/Users/dell/LunaCrypto/apps/ai-service/config/default.toml)
- Modify: [apps/ai-service/luna_workstation/default_config.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/default_config.py)
- Modify: [apps/ai-service/luna_workstation/config/schema.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/config/schema.py)

### API boundary layer

- Modify: [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- Modify: [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)
- Modify: [apps/api/src/workspaces/workspaces.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/workspaces/workspaces.service.ts)
- Modify: [apps/api/src/contracts/openapi.generated.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/openapi.generated.ts) via regeneration if applicable

### Market-data/provider layer

- Modify: [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)

### Web/UI layer

- Modify: [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- Modify: [apps/web/src/components/navigation/WorkspaceSwitcher.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/components/navigation/WorkspaceSwitcher.tsx)
- Modify: [apps/web/src/types/index.ts](/C:/Users/dell/LunaCrypto/apps/web/src/types/index.ts)
- Modify: [apps/web/src/services/generated/api-client.ts](/C:/Users/dell/LunaCrypto/apps/web/src/services/generated/api-client.ts) if regeneration is required

### Data/migration layer

- Modify: Postgres migration files under `apps/api/src/database/` as needed
- Modify: [apps/api/src/database/postgres-schema.sql](/C:/Users/dell/LunaCrypto/apps/api/src/database/postgres-schema.sql)

## Implementation Tasks

### Task 1: Remove spot defaults and fallback normalization

**Files:**
- Modify: [apps/ai-service/config/default.toml](/C:/Users/dell/LunaCrypto/apps/ai-service/config/default.toml)
- Modify: [apps/ai-service/luna_workstation/default_config.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/default_config.py)
- Modify: [apps/ai-service/luna_workstation/config/schema.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/config/schema.py)
- Test: relevant AI-service tests under `apps/ai-service/tests`

- [ ] Change default market type from `spot` to `perp`.
- [ ] Stop normalizing invalid market types to `spot`.
- [ ] Add focused tests for config validation behavior.
- [ ] Run focused Python/AI-service tests.

### Task 2: Tighten API and UI launch contracts

**Files:**
- Modify: [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- Modify: [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)
- Modify: [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- Modify: [apps/web/src/types/index.ts](/C:/Users/dell/LunaCrypto/apps/web/src/types/index.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts), relevant web tests

- [ ] Tighten run-creation contracts to perp-only where product scope now requires it.
- [ ] Remove lingering spot-only launch copy from web/UI.
- [ ] Regenerate client/types if necessary.
- [ ] Run focused API and web verification.

### Task 3: Simplify market-data provider routing

**Files:**
- Modify: [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Remove accidental default-to-spot routing.
- [ ] Decide whether spot branches should be deleted or left behind guarded by an unreachable contract.
- [ ] Add tests that provider paths now use perp-only routing where the platform contract requires it.
- [ ] Re-run focused API tests.

### Task 4: Resolve workspace and legacy-data handling

**Files:**
- Modify: [apps/api/src/workspaces/workspaces.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/workspaces/workspaces.service.ts)
- Modify: [apps/web/src/components/navigation/WorkspaceSwitcher.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/components/navigation/WorkspaceSwitcher.tsx)
- Modify: database migration/schema files as needed
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts), [apps/web/test/workspace-switcher.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/workspace-switcher.test.ts)

- [ ] Choose migration vs quarantine for `mixed` and `spot` workspace artifacts.
- [ ] Prevent the workspace surface from silently restoring spot defaults.
- [ ] Add migration or filtering tests for legacy behavior.
- [ ] Re-run focused API/web tests.

## Acceptance Criteria

V9 is done when:

- No core platform path silently defaults to `spot`.
- Invalid market-type normalization no longer falls back to `spot`.
- Launch/workspace/provider paths align with a perp-first contract.
- Legacy spot data is either migrated or explicitly quarantined from current product flows.
- Product semantics built in V8.2-V8.4 still pass after the migration.

## Verification Commands

```bash
cd C:\Users\dell\LunaCrypto
node --test --test-name-pattern "market_type|workspace|klines|perp" apps/api/test/api-contract.test.ts

cd C:\Users\dell\LunaCrypto\apps\web
npm run typecheck
node --test C:\Users\dell\LunaCrypto\apps\web\test\workspace-switcher.test.ts

cd C:\Users\dell\LunaCrypto
node apps/ai-service/scripts/python.cjs -m pytest apps/ai-service/tests -k "market_type or config"
```
