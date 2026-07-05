# Opportunity Semantics And State V8.3 Implementation Plan

Status: design-ready, recommended immediately after V8.2 trade-lab boundary lock
Last updated: 2026-07-06

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed scenario/playbook/simulation UI heuristics with a durable opportunity read model and state contract that clearly separates watch scenarios, trade setups, and paper positions.

**Architecture:** V8.3 introduces `opportunity_card.v1` as a derived read model built from `ScenarioResponse`, `trade_playbook.v1`, `simulation_run.v1`, and chart/live-state projections. The API decides card kind, status, blockers, and allowed actions. Web surfaces render from that card instead of inferring state ad hoc from multiple payloads.

**Tech Stack:** NestJS/TypeScript contracts and services, React/Vite, TanStack Query, existing scenario/playbook/paper-execution services, Node test runner, TypeScript typecheck.

---

## Product Scope

V8.3 answers:

```text
Is this card just a watch scenario, a trade setup, or a paper position?
What stage is the setup in right now?
What is the next required condition?
Why is the card blocked or non-actionable?
Which actions are allowed from this state?
```

V8.3 must not create:

```text
auto-settlement
platform-level spot purge
broker execution
portfolio-level accounting
LLM-only card states
free-form UI inference of trade status
```

## Problem Statement

Current product behavior still mixes several layers:

```text
scenario
trigger
playbook
opportunity
simulation
position
```

That produces misleading UI states such as:

- neutral or watch-only scenario still reading like an opportunity
- missing playbook but trade semantics still showing through the card
- scenario trigger interpreted as entry readiness
- invalidation rendered like a stop-loss without semantic separation

The product needs an explicit opportunity state contract before more lifecycle
automation is added.

## Goals

1. Introduce a single API/web contract for trade-surface cards.
2. Separate `watch_scenario`, `trade_setup`, and `paper_position`.
3. Separate setup invalidation, risk exit, and thesis invalidation in UI-facing semantics.
4. Block multi-stage scenarios from collapsing into flat trade cards without sequence.
5. Make allowed actions API-driven instead of UI-guessed.

## Non-Goals

1. Do not add auto-settlement yet.
2. Do not remove current simulation/event ledger contracts.
3. Do not purge spot globally.
4. Do not add broker tickets or live orders.

## Proposed Read Model

V8.3 should add:

```ts
type OpportunityCardStatus =
  | 'watch_only'
  | 'blocked'
  | 'waiting_for_setup'
  | 'setup_armed'
  | 'waiting_for_entry'
  | 'entry_triggered'
  | 'simulation_waiting'
  | 'position_open'
  | 'partially_closed'
  | 'target_hit'
  | 'risk_exit_hit'
  | 'expired'
  | 'invalidated'
  | 'settled';

type OpportunityCardKind =
  | 'watch_scenario'
  | 'trade_setup'
  | 'paper_position'
  | 'diagnostic';
```

The card must be able to answer:

```text
kind
status
next_condition
entry
risk_exit
thesis_invalidation
targets
expiry
warnings
blockers
allowed_actions
```

## Semantic Rules

1. `watch_scenario`
   - missing playbook
   - neutral/watch-only/non-directional recommendation
   - unresolved blockers
   - non-chartable/non-tradeable setup

2. `trade_setup`
   - current playbook exists
   - directional long/short
   - entry/risk exit/target/expiry are usable
   - no hard blocker preventing simulation

3. `paper_position`
   - active simulation exists with actual position state
   - position information takes precedence over setup-only wording

## Setup Sequence Requirement

Multi-stage scenarios must no longer flatten into a single `entry/invalidation/target`
shape without explicit sequencing. V8.3 should add or surface a compact
`setup_sequence` / `setup_stage` model for UI and compile gating.

Example phases:

```text
precondition
arm
confirmation
entry
risk_exit
target
expiry
```

## File Plan

### New or likely-new files

- Create: `apps/api/src/scenarios/opportunity-card.types.ts`
- Create: `apps/api/src/scenarios/opportunity-card.service.ts`

### Existing files likely to change

- Modify: [apps/api/src/contracts/frontend-contract.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/frontend-contract.ts)
- Modify: [apps/api/src/scenarios/scenario-chart-projection.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-chart-projection.service.ts)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Modify: [apps/api/src/playbooks/playbook-compiler.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/playbooks/playbook-compiler.service.ts)
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/pages/scenario-view-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/pages/scenario-view-model.ts)
- Modify: [apps/web/src/components/scenarios/paper-simulation-read-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/components/scenarios/paper-simulation-read-model.ts)

### Tests likely to change

- Modify/Create: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)
- Modify/Create: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/thesis-detail-layout.test.ts)
- Modify/Create: [apps/web/test/scenario-chart-behavior.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/scenario-chart-behavior.test.ts)

## Implementation Tasks

### Task 1: Define the opportunity card contract

**Files:**
- Create: `apps/api/src/scenarios/opportunity-card.types.ts`
- Modify: [apps/api/src/contracts/frontend-contract.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/frontend-contract.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Add `opportunity_card.v1` types with `kind`, `status`, `entry`, `risk_exit`, `thesis_invalidation`, `targets`, `blockers`, and `allowed_actions`.
- [ ] Expose the card through the frontend contract shape used by thesis/scenario surfaces.
- [ ] Add focused contract tests for each `kind` and at least these statuses: `watch_only`, `blocked`, `waiting_for_entry`, `position_open`.
- [ ] Run focused API contract tests for the new contract.

### Task 2: Build the API read model from existing sources

**Files:**
- Create: `apps/api/src/scenarios/opportunity-card.service.ts`
- Modify: [apps/api/src/scenarios/scenario-chart-projection.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-chart-projection.service.ts)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Build `watch_scenario` cards from scenario/runtime/live-state only.
- [ ] Build `trade_setup` cards only when playbook/risk/target/expiry semantics are sufficient.
- [ ] Build `paper_position` cards when simulation detail includes a live position.
- [ ] Add API tests proving active paper positions take precedence over setup-only wording.
- [ ] Re-run focused API contract tests.

### Task 3: Separate setup invalidation, risk exit, and thesis invalidation

**Files:**
- Modify: [apps/api/src/playbooks/playbook-compiler.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/playbooks/playbook-compiler.service.ts)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)
- Test: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/thesis-detail-layout.test.ts)

- [ ] Preserve thesis invalidation as research meaning.
- [ ] Preserve or derive risk exit as execution meaning.
- [ ] Add UI labels that no longer collapse every invalidation into a stop-like message.
- [ ] Add regression tests preventing a single invalidation field from driving all meanings.
- [ ] Run focused API and web tests.

### Task 4: Add sequence-aware setup state for multi-stage scenarios

**Files:**
- Modify: [apps/api/src/playbooks/playbook-compiler.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/playbooks/playbook-compiler.service.ts)
- Modify: [apps/api/src/scenarios/opportunity-card.service.ts](C:/Users/dell/LunaCrypto/apps/api/src/scenarios/opportunity-card.service.ts)
- Modify: [apps/web/src/pages/scenario-view-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/pages/scenario-view-model.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Reject or downgrade flat compilation for multi-stage scenarios without sequence.
- [ ] Add `setup_stage` or equivalent surfaced state to the opportunity card.
- [ ] Add tests for one bull-trap-like setup where entry cannot be considered valid before preconditions pass.
- [ ] Re-run focused tests.

### Task 5: Switch the web surface to render only from opportunity-card semantics

**Files:**
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/components/scenarios/paper-simulation-read-model.ts](/C:/Users/dell/LunaCrypto/apps/web/src/components/scenarios/paper-simulation-read-model.ts)
- Test: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/scenario-decision-workbench.test.ts)

- [ ] Stop deriving main card semantics from scattered fields when `opportunity_card` is present.
- [ ] Render badges, status text, and allowed actions from the card.
- [ ] Add web tests ensuring `watch_scenario` never rebrands itself as a trade setup.
- [ ] Run focused web tests and `npm run typecheck`.

## Acceptance Criteria

V8.3 is done when:

- The API exposes a single opportunity-card read model.
- Watch scenarios, trade setups, and paper positions are visibly distinct.
- Multi-stage scenarios no longer flatten into misleading trade cards.
- UI actions are derived from allowed card actions instead of ad hoc heuristics.
- The trade surface can explain why a card is blocked or non-actionable.

## Verification Commands

```bash
cd C:\Users\dell\LunaCrypto
node --test --test-name-pattern "opportunity|setup|risk exit|invalidation" apps/api/test/api-contract.test.ts

cd C:\Users\dell\LunaCrypto\apps\web
npm run typecheck
node --test C:\Users\dell\LunaCrypto\apps\web\test\thesis-detail-layout.test.ts
node --test C:\Users\dell\LunaCrypto\apps\web\test\scenario-chart-behavior.test.ts
```
