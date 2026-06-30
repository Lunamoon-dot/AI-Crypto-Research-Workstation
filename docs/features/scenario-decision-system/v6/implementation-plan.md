# Scenario Decision Workbench V6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate scenario monitoring, evaluation, reliability, playbooks, and backtests into one operator workbench.

**Architecture:** V6 adds a scenario-specific workbench aggregation service on top of existing resources. It does not replace `GET /workbench/attention` immediately; it creates a richer scenario decision queue when the scenario lifecycle has enough artifacts to justify a dedicated surface.

**Tech Stack:** NestJS/TypeScript API, existing scenario/evaluation/playbook/backtest services, React/Vite UI, Node test runner.

---

## Product Scope

V6 answers:

```text
What scenario needs attention now?
Which scenario evaluation is due?
Which recommendation was wrong or inconclusive?
Which playbook can be compiled?
Which backtest result is ready?
What should the operator review next?
```

V6 is a workflow surface. It does not create a new evaluation or simulation
engine.

## Existing Inputs

V6 depends on:

```text
Scenario Recommendation V1
Scenario Evaluation V2
Scenario Reliability Memory V3
Trade Playbook Compiler V4
Backtest Lab V5
Research Continuity timeline
Workbench Attention
```

## New Contract

Add:

```ts
export type ScenarioDecisionQueueItemType =
  | 'active_scenario'
  | 'evaluation_due'
  | 'evaluation_inconclusive'
  | 'reliability_changed'
  | 'playbook_candidate'
  | 'backtest_ready';

export interface ScenarioDecisionQueueItemResponse {
  version: 'scenario_decision_queue_item.v1';
  id: string;
  workspace_id: string;
  type: ScenarioDecisionQueueItemType;
  priority: number;
  title: string;
  summary: string;
  scenario_id: string | null;
  thesis_id: string | null;
  playbook_id: string | null;
  backtest_id: string | null;
  status: 'open' | 'snoozed' | 'resolved';
  blockers: string[];
  next_action: string;
  due_at: string | null;
  created_at: string;
}
```

## Files

Create:

```text
apps/api/src/scenario-decision/scenario-decision.module.ts
apps/api/src/scenario-decision/scenario-decision.controller.ts
apps/api/src/scenario-decision/scenario-decision-workbench.service.ts
apps/api/src/scenario-decision/scenario-decision.types.ts
apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx
apps/web/test/scenario-decision-workbench.test.ts
```

Modify:

```text
apps/api/src/app.module.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/App.tsx
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/styles/index.css
```

## Task 1: Add Workbench Aggregation Service

**Files:**

- Create: `apps/api/src/scenario-decision/scenario-decision-workbench.service.ts`
- Create: `apps/api/src/scenario-decision/scenario-decision.types.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing queue priority tests**

Add tests:

```ts
test('scenario decision workbench prioritizes triggered scenarios first', async () => {});
test('scenario decision workbench includes due evaluations', async () => {});
test('scenario decision workbench includes playbook candidates after eligible recommendation', async () => {});
test('scenario decision workbench includes ready backtests', async () => {});
```

- [ ] **Step 2: Implement queue builder**

Priority rules:

```text
100 triggered scenario with passed hard gates
90  evaluation due
80  near-trigger scenario
70  inconclusive evaluation
60  playbook candidate
50  backtest ready
40  reliability changed
```

- [ ] **Step 3: Add blockers and next action**

Every item should include:

- Human-readable title.
- Summary.
- Blockers.
- Next action.
- Linkable ids.

- [ ] **Step 4: Re-run API tests**

Run API typecheck and contract tests.

## Task 2: Add Workbench API

**Files:**

- Create: `apps/api/src/scenario-decision/scenario-decision.controller.ts`
- Create: `apps/api/src/scenario-decision/scenario-decision.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write route tests**

Add:

```ts
test('GET /scenario-decision/workbench returns ordered queue items', async () => {});
test('POST /scenario-decision/items/:id/resolve marks an item resolved', async () => {});
test('POST /scenario-decision/items/:id/snooze hides item until due time', async () => {});
```

- [ ] **Step 2: Implement routes**

Routes:

```text
GET /scenario-decision/workbench
POST /scenario-decision/items/:id/resolve
POST /scenario-decision/items/:id/snooze
```

If durable resolve/snooze state is too broad for V6.0, implement the GET route
first and defer mutations to V6.1. Do not expose buttons in UI until mutations
exist.

- [ ] **Step 3: Re-run API tests**

Run API tests.

## Task 3: Add Scenario Decision Workbench Page

**Files:**

- Create: `apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/index.css`
- Test: `apps/web/test/scenario-decision-workbench.test.ts`

- [ ] **Step 1: Write UI tests**

Assertions:

- Page renders queue sections.
- Triggered item appears above due evaluation.
- Items show blockers and next action.
- Empty state says no scenario decision items need attention.

- [ ] **Step 2: Implement page**

Page should be dense and operational:

- Header with total open items.
- Filter tabs by item type.
- Main list sorted by priority.
- Compact metadata row for scenario/thesis/playbook/backtest ids.
- No hero or marketing section.

- [ ] **Step 3: Re-run web tests**

Run:

```powershell
tsc -p apps/web/tsconfig.json --noEmit
node --test --experimental-strip-types --experimental-default-type=module test/scenario-decision-workbench.test.ts
```

## Task 4: Connect Workbench To Existing Navigation

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: relevant nav component if one exists in the current branch
- Test: `apps/web/test/scenario-decision-workbench.test.ts`

- [ ] **Step 1: Add route test**

Assert route `/scenario-decision` points to the new page.

- [ ] **Step 2: Add nav entry**

Use label:

```text
Scenario Decision
```

Do not use:

```text
Auto Trading
Execution
Signals Bot
```

- [ ] **Step 3: Re-run web tests**

Run web typecheck and focused tests.

## Definition Of Done

- Scenario decision queue aggregates scenario lifecycle artifacts.
- Queue priority is deterministic.
- Workbench page renders the next action and blockers.
- UI remains research/operator focused.
- No copy implies live execution.

## Final Product Acceptance

The Scenario Decision System is complete when:

- A scenario can be generated, recommended, monitored, evaluated, learned from,
  compiled, and backtested.
- The workbench shows the next operator action.
- Missing data and uncertainty remain visible.
- Every action is workspace scoped and auditable.
