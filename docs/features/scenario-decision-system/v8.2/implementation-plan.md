# Trade-Lab Perp-Only Boundary V8.2 Implementation Plan

Status: design-ready, recommended next slice before opportunity card/state-machine work
Last updated: 2026-07-06

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**North Star:** Make the trade-facing Luna surface unambiguously perpetual-futures
only before deepening execution semantics.

**Goal:** Lock the trade-lab product surface to `perp` artifacts, requests, and
actions without purging spot support from the full repo yet.

**Architecture:** V8.2 is a product-boundary release, not a platform migration.
It normalizes trade-lab launch requests to `market_type = "perp"`, removes spot
selection from the main launch UI, filters non-perp artifacts out of the
opportunity surface, and blocks paper-simulation entry points for non-perp
artifacts. Existing spot contracts, provider branches, and legacy data remain
in place outside the trade-lab boundary.

**Tech Stack:** React/Vite web app, Zod request schema, NestJS DTO/service
boundary, existing scenario/playbook/paper-execution services, Node test
runner, TypeScript typecheck.

---

## Product Scope

V8.2 answers:

```text
Can a trade user still launch spot from the main product path?
Can a spot artifact still masquerade as a trade setup?
Can trade-lab simulation/replay start from a non-perp source?
Can we tighten the trade surface without rewriting the whole platform?
```

V8.2 must not create:

```text
global spot purge
provider-branch deletion
workspace-model migration
broker execution
opportunity state machine
auto-settlement
legacy data rewrite
```

## Problem Statement

Current repo behavior still exposes spot semantics in the product path even
though the trade-facing direction is now perp-focused:

- [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
  still renders both `Spot desk` and `Perp desk`, with `spot` as the default.
- [apps/web/src/schemas/research-run.ts](/C:/Users/dell/LunaCrypto/apps/web/src/schemas/research-run.ts)
  defaults `market_type` to `spot`.
- [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
  accepts both `spot` and `perp`.
- [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)
  defaults missing `market_type` to `spot`.
- [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)
  still branches correctly between spot and perp providers, which is fine for
  now and should remain untouched in this phase.

This creates the wrong operator impression: the product is visually moving
toward a trade/perp lab, but the boundary still allows spot launch and spot
artifacts to bleed into trade semantics.

## Goals

1. The main trade-lab launch path must be perp-only.
2. Trade-lab request normalization must force `market_type = "perp"` even if a
   client sends `spot`.
3. The opportunity surface must not display non-perp artifacts as watch/setup/
   simulation cards.
4. Paper simulation and replay entry points in the trade surface must be
   unavailable for non-perp artifacts.
5. Existing research or legacy spot paths outside trade-lab must continue to
   work.

## Non-Goals

1. Do not remove spot support from global DTOs, types, OpenAPI, or provider
   code outside the trade-lab boundary.
2. Do not migrate old data from spot to perp.
3. Do not change workspace-wide `mixed | spot | perp` semantics yet.
4. Do not change simulation engine internals beyond enforcing the entry gate.
5. Do not add `opportunity_card.v1` yet.
6. Do not add auto-settlement or scenario outcome snapshots yet.

## Existing Code Paths To Reuse

### Trade-lab launch path

- [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- [apps/web/src/schemas/research-run.ts](/C:/Users/dell/LunaCrypto/apps/web/src/schemas/research-run.ts)
- [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)

### Trade-facing opportunity/simulation surface

- [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- [apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx)
- [apps/web/src/components/scenarios/paper-simulation-read-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/components/scenarios/paper-simulation-read-model.ts)
- [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- [apps/api/src/scenarios/scenario-chart-projection.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-chart-projection.service.ts)

### Legacy/data paths that remain untouched in this phase

- [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)
- [apps/ai-service/config/default.toml](/C:/Users/dell/LunaCrypto/apps/ai-service/config/default.toml)
- [apps/ai-service/luna_workstation/default_config.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/default_config.py)
- [apps/api/src/workspaces/workspaces.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/workspaces/workspaces.service.ts)

These files are listed so implementers do not accidentally widen the phase.

## Delivery Phases

The overall direction remains:

```text
Phase 1: trade-lab surface perp-only
Phase 2: opportunity card + semantic/state cleanup
Phase 3: auto outcome and replay-first lifecycle
Phase 4: optional platform-level spot purge
```

V8.2 implements only Phase 1.

## Phase 1 Behavior Contract

### 1. Launch UI behavior

Trade-lab launch must not offer a spot choice:

```text
Before:
  Spot desk
  Perp desk

After:
  Perpetual futures only
```

Allowed implementations:

- Remove the market-type selector completely and hardcode `perp`, or
- Keep a single visual option that still serializes to `perp`.

Disallowed implementation:

- Showing `spot` and silently rewriting it later.

### 2. Frontend schema behavior

The trade-lab request schema must serialize `market_type = "perp"` for the main
launch path.

The cleanest boundary for this phase is:

```ts
market_type: z.literal('perp').default('perp')
```

Do not widen that schema again for convenience inside the trade-lab path.

### 3. API normalization behavior

The create-run boundary must normalize trade-lab requests to perp:

```text
input missing market_type -> perp
input spot in trade-lab path -> perp
input perp in trade-lab path -> perp
```

This normalization is product-boundary logic, not a repo-wide contract change.

### 4. Opportunity surface filtering

Trade-lab surfaces must not render non-perp artifacts as actionable cards.

Required behavior:

- Non-perp artifacts are hidden from the main trade/opportunity surface, or
- They are downgraded into a non-actionable diagnostic/legacy artifact state.

Disallowed behavior:

- Rendering a non-perp artifact as a watch setup
- Rendering a non-perp artifact as a trade setup
- Enabling compile/simulate/replay actions for a non-perp artifact

### 5. Simulation/replay gate

If a playbook or scenario source is not `perp`, the trade-facing simulation
surface must block entry with a clear message:

```text
Trade lab supports perpetual futures only.
```

This gate belongs at the product boundary first. Deeper engine hardening may
follow later if needed.

## Operator Semantics

V8.2 intentionally does not solve the full semantic mismatch between:

```text
watch scenario
trade setup
paper position
```

That remains Phase 2.

But V8.2 must still ensure the trade-lab surface does not send the operator the
wrong market-contract message. A spot artifact should fail fast as a trade-lab
artifact even if other semantics are still being cleaned up.

## File Plan

### Must change in V8.2

- Modify: [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- Modify: [apps/web/src/schemas/research-run.ts](/C:/Users/dell/LunaCrypto/apps/web/src/schemas/research-run.ts)
- Modify: [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- Modify: [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx) only if its trade surface still renders non-perp action paths

### May change if filtering needs a read-model hook

- Modify: [apps/web/src/components/scenarios/paper-simulation-read-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/components/scenarios/paper-simulation-read-model.ts)
- Modify: [apps/api/src/scenarios/scenario-chart-projection.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-chart-projection.service.ts)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)

### Must not change in V8.2 unless a blocker is proven

- [apps/api/src/market-data/market-ohlcv.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/market-data/market-ohlcv.service.ts)
- [apps/api/src/workspaces/workspaces.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/workspaces/workspaces.service.ts)
- [apps/ai-service/config/default.toml](/C:/Users/dell/LunaCrypto/apps/ai-service/config/default.toml)
- [apps/ai-service/luna_workstation/config/schema.py](/C:/Users/dell/LunaCrypto/apps/ai-service/luna_workstation/config/schema.py)

## Implementation Tasks

### Task 1: Lock the trade-lab launch form to perp

**Files:**
- Modify: [apps/web/src/pages/ResearchRunFormPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ResearchRunFormPage.tsx)
- Modify: [apps/web/src/schemas/research-run.ts](/C:/Users/dell/LunaCrypto/apps/web/src/schemas/research-run.ts)
- Test: [apps/web/test](</C:/Users/dell/LunaCrypto/apps/web/test>)

- [ ] Remove `Spot desk` from the main launch choice set or hide the market-type selector entirely for the trade-lab path.
- [ ] Replace the launch-form default from `spot` to `perp`.
- [ ] Change the trade-lab request schema so `market_type` is serialized as literal `perp`.
- [ ] Add or update a web test that asserts the trade-lab launch path no longer exposes `Spot desk`.
- [ ] Run focused web tests and `npm run typecheck` in `apps/web`.

### Task 2: Normalize the create-run boundary to perp for trade-lab

**Files:**
- Modify: [apps/api/src/research-runs/dto/create-research-run.dto.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/dto/create-research-run.dto.ts)
- Modify: [apps/api/src/research-runs/research-runs.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/research-runs/research-runs.service.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Add a small normalizer/helper for trade-lab run creation that returns `perp`.
- [ ] Keep the broader DTO/API contract stable unless a narrower change is proven safe.
- [ ] Ensure trade-lab path does not persist `spot` when the UI or client sends it.
- [ ] Add contract coverage proving trade-lab create-run requests persist `market_type = 'perp'`.
- [ ] Run focused API contract tests for create-run behavior.

### Task 3: Hide or downgrade non-perp artifacts in the trade surface

**Files:**
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx) if required
- Test: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/thesis-detail-layout.test.ts)

- [ ] Add a trade-lab eligibility guard based on `market_type === 'perp'`.
- [ ] Do not render non-perp artifacts as actionable trade cards.
- [ ] If needed for operator clarity, render a diagnostic/legacy state instead of an actionable card.
- [ ] Add a UI test proving non-perp artifacts do not surface as trade opportunities.
- [ ] Re-run focused web tests and `npm run typecheck`.

### Task 4: Gate paper simulation/replay to perp artifacts in the product surface

**Files:**
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts) only if the UI-only gate is insufficient
- Test: [apps/web/test/paper-execution-ui-copy.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/paper-execution-ui-copy.test.ts)

- [ ] Block `Start simulation` and `Run replay` for non-perp artifacts in the trade surface.
- [ ] Use a clear operator-facing message such as `Trade lab supports perpetual futures only.`
- [ ] Add a focused UI test for the blocker copy or gated action visibility.
- [ ] Only add a backend guard if UI-only enforcement is not trustworthy enough for this slice.

## Acceptance Criteria

V8.2 is done when:

- The main trade launch path no longer exposes `Spot desk`.
- Trade-lab launch requests always persist `market_type = 'perp'`.
- Non-perp artifacts no longer appear as actionable cards in the trade-facing
  surface.
- Simulation/replay entry points are unavailable for non-perp trade-lab
  artifacts.
- Existing spot-capable platform code still compiles and remains available for
  non-trade flows.

## Verification Commands

Minimum verification before claiming completion:

```bash
cd C:\Users\dell\LunaCrypto\apps\web
npm run typecheck

node --test C:\Users\dell\LunaCrypto\apps\web\test\thesis-detail-layout.test.ts
node --test C:\Users\dell\LunaCrypto\apps\web\test\paper-execution-ui-copy.test.ts

cd C:\Users\dell\LunaCrypto
node --test --test-name-pattern "research run|market_type|trade lab" apps/api/test/api-contract.test.ts
```

If the API focused filter name is too broad, narrow it to the exact tests added
in this slice.

## Follow-On Versions

After V8.2:

- V8.3 or equivalent should define `opportunity_card.v1` and the
  `watch_scenario | trade_setup | paper_position` split.
- The next lifecycle slice should replace manual evaluate semantics with
  auto-settlement and `scenario_outcome_snapshot`.
- Platform-wide spot purge should happen only after trade-lab semantics are
  stable and operator-safe.
