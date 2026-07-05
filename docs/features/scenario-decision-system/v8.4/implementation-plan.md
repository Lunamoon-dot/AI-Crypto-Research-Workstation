# Auto Outcome And Settlement V8.4 Implementation Plan

Status: design-ready, recommended after V8.3 opportunity semantics stabilize
Last updated: 2026-07-06

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual scenario evaluation from the main operator flow and replace it with deterministic outcome settlement and replay-first post-hoc review.

**Architecture:** V8.4 adds `scenario_outcome_snapshot.v1` as a durable lifecycle artifact derived from scenario maturity, simulation outcomes, and replay windows anchored at scenario generation time. It repositions evaluation as backend settlement logic, not a foreground operator button. Reliability updates consume settled outcomes rather than ad hoc manual evaluation actions on the trade surface.

**Tech Stack:** NestJS/TypeScript API, Postgres journal repository, existing scenario-evaluation and paper-execution services, React/Vite UI cleanup, Node test runner.

---

## Product Scope

V8.4 answers:

```text
What happened to this scenario after it expired, invalidated, or completed?
Was the setup triggered?
Was an entry hit?
Did risk exit or target happen first?
What was the paper outcome if simulation existed?
Can we update reliability without a manual Evaluate button?
```

V8.4 must not create:

```text
true broker backtesting
global reliability redesign
portfolio PnL accounting
platform-wide data migrations
live order routing
```

## Problem Statement

Manual `Evaluate` and generic historical `Run backtest` do not fit the scenario
trade flow:

- evaluation is a lifecycle outcome, not an operator foreground action
- backtest over arbitrary prior history is not the right semantic for a
  one-off scenario generated at a specific time
- replay should answer "what happened after this scenario was generated?"
  instead of "what if I applied this setup 90 days earlier?"

## Goals

1. Add a durable `scenario_outcome_snapshot.v1`.
2. Auto-settle outcomes on `expired`, `invalidated`, `target_hit`,
   `risk_exit_hit`, `missed_entry`, `data_end`, or equivalent completion paths.
3. Hide manual `Evaluate` from the main trade flow.
4. Keep replay anchored to `generated_at` + scenario window, not arbitrary
   generic backtest assumptions.
5. Preserve enough evidence for later reliability updates.

## Non-Goals

1. Do not remove every historical evaluation endpoint in this phase.
2. Do not redesign all reliability reporting surfaces at once.
3. Do not introduce execution-grade PnL accounting.
4. Do not do platform-wide spot purge here.

## Proposed Contract

```ts
type ScenarioOutcomeSnapshotV1 = {
  version: 'scenario_outcome_snapshot.v1';
  scenario_id: string;
  playbook_id: string | null;
  simulation_id: string | null;
  generated_at: string;
  settled_at: string;
  settlement_reason:
    | 'expired'
    | 'invalidated'
    | 'target_hit'
    | 'risk_exit_hit'
    | 'missed_entry'
    | 'data_end'
    | 'manual_abandon';
  trigger_hit: boolean | null;
  trigger_hit_at: string | null;
  entry_hit: boolean | null;
  entry_hit_at: string | null;
  invalidation_hit: boolean | null;
  invalidation_hit_at: string | null;
  target_hit: boolean | null;
  target_hit_at: string | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  paper_realized_pnl: string | null;
  paper_realized_pnl_pct: string | null;
  prediction_quality: 'supported' | 'challenged' | 'invalidated' | 'inconclusive';
  execution_quality:
    | 'not_simulated'
    | 'rule_following'
    | 'late_entry'
    | 'premature_entry'
    | 'missed_trigger'
    | 'insufficient_data';
  data_quality: 'complete' | 'partial' | 'insufficient';
  warnings: string[];
};
```

## File Plan

### New or likely-new files

- Create: `apps/api/src/scenarios/scenario-outcome.types.ts`
- Create: `apps/api/src/scenarios/scenario-outcome.service.ts`

### Existing files likely to change

- Modify: [apps/api/src/scenarios/scenario-evaluation.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-evaluation.service.ts)
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Modify: [apps/api/src/contracts/frontend-contract.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/frontend-contract.ts)
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/services/scenario-decision.ts](/C:/Users/dell/LunaCrypto/apps/web/src/services/scenario-decision.ts)

### Tests likely to change

- Modify/Create: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)
- Modify/Create: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/thesis-detail-layout.test.ts)

## Implementation Tasks

### Task 1: Define the outcome snapshot contract

**Files:**
- Create: `apps/api/src/scenarios/scenario-outcome.types.ts`
- Modify: [apps/api/src/contracts/frontend-contract.ts](/C:/Users/dell/LunaCrypto/apps/api/src/contracts/frontend-contract.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Add `scenario_outcome_snapshot.v1` types and contract normalization.
- [ ] Expose settled outcome fields needed by the trade surface and reliability consumers.
- [ ] Add API contract tests for core settlement reasons and nullability semantics.
- [ ] Run focused API tests.

### Task 2: Convert manual evaluation logic into settlement helpers

**Files:**
- Modify: [apps/api/src/scenarios/scenario-evaluation.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-evaluation.service.ts)
- Create: `apps/api/src/scenarios/scenario-outcome.service.ts`
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Extract candle/stat/outcome helpers from manual evaluation into reusable settlement logic.
- [ ] Preserve existing evidence quality rules while shifting main-trade usage to outcomes.
- [ ] Add tests for missing-window, insufficient-data, and mature-window settlement behavior.
- [ ] Re-run focused API tests.

### Task 3: Settle from simulation completion and lifecycle transitions

**Files:**
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Modify: [apps/api/src/scenarios/scenario-outcome.service.ts](C:/Users/dell/LunaCrypto/apps/api/src/scenarios/scenario-outcome.service.ts)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Persist a settled outcome when simulation completes with target/risk-exit/data-end/missed-entry semantics.
- [ ] Avoid synthetic "success" on engine failure.
- [ ] Add tests ensuring completed simulations produce outcome snapshots with correct settlement reasons.
- [ ] Re-run focused API tests.

### Task 4: Remove manual Evaluate from the main trade UI

**Files:**
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Modify: [apps/web/src/services/scenario-decision.ts](/C:/Users/dell/LunaCrypto/apps/web/src/services/scenario-decision.ts)
- Test: [apps/web/test/thesis-detail-layout.test.ts](/C:/Users/dell/LunaCrypto/apps/web/test/thesis-detail-layout.test.ts)

- [ ] Remove any remaining main-flow Evaluate action copy from the trade surface.
- [ ] Replace it with settled outcome display when present.
- [ ] Add tests proving the trade card uses settled outcome semantics instead of manual evaluate.
- [ ] Run web tests and typecheck.

### Task 5: Reposition replay as generated-at outcome review

**Files:**
- Modify: [apps/api/src/paper-execution/paper-execution.service.ts](/C:/Users/dell/LunaCrypto/apps/api/src/paper-execution/paper-execution.service.ts)
- Modify: [apps/web/src/pages/ThesisDetailPage.tsx](/C:/Users/dell/LunaCrypto/apps/web/src/pages/ThesisDetailPage.tsx)
- Test: [apps/api/test/api-contract.test.ts](/C:/Users/dell/LunaCrypto/apps/api/test/api-contract.test.ts)

- [ ] Ensure replay defaults and messaging align with scenario-generated window semantics.
- [ ] Avoid generic historical backtest framing in the main trade surface.
- [ ] Add a regression test that replay anchors from scenario generation instead of arbitrary 90-day defaults.
- [ ] Re-run focused API/web tests.

## Acceptance Criteria

V8.4 is done when:

- Main trade UI no longer needs manual Evaluate semantics.
- Settled outcomes persist as first-class artifacts.
- Completed/expired/invalidated trade flows can produce deterministic outcome snapshots.
- Replay semantics are tied to scenario-generated time windows.
- Reliability consumers have a stable outcome artifact to build from.

## Verification Commands

```bash
cd C:\Users\dell\LunaCrypto
node --test --test-name-pattern "outcome|settle|evaluation|replay" apps/api/test/api-contract.test.ts

cd C:\Users\dell\LunaCrypto\apps\web
npm run typecheck
node --test C:\Users\dell\LunaCrypto\apps\web\test\thesis-detail-layout.test.ts
```
