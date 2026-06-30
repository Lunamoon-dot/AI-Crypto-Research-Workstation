# Trade Playbook Compiler V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile eligible scenario recommendations into deterministic manual trade playbooks that can later be simulated.

**Architecture:** V4 adds a strict compiler and persisted playbook resource. The compiler consumes scenario recommendation, runtime decision, evaluation history, and reliability context, then either creates `trade_playbook.v1` or returns a structured rejection report.

**Tech Stack:** NestJS/TypeScript API, journal repository, Postgres persistence, React/Vite UI, existing scenario view model, Node test runner.

---

## Product Scope

V4 answers:

```text
Can this scenario become a manual playbook?
What is the exact trigger?
What invalidates it?
Where are the targets?
What no-trade conditions block it?
Why was compilation rejected?
```

V4 is not a backtest and not execution.

## Existing Inputs

V4 depends on:

```text
scenario_recommendation.v1
scenario_runtime_decision.v1
scenario_evaluation.v1
scenario_reliability_profile.v1
trade thesis direction and confidence
market type
trigger and invalidation structure
```

## New Contract

Add:

```ts
export interface TradePlaybookResponse {
  version: 'trade_playbook.v1';
  id: string;
  workspace_id: string;
  source_scenario_id: string;
  source_thesis_id: string;
  symbol: string;
  market_type: 'spot' | 'perp';
  direction: 'long' | 'short' | 'avoid';
  horizon: string;
  entry: {
    type: 'level' | 'zone' | 'condition';
    condition: string;
    level: number | null;
    zone_low: number | null;
    zone_high: number | null;
  };
  invalidation: {
    condition: string;
    level: number | null;
  };
  targets: Array<{
    label: string;
    level: number | null;
    rationale: string;
  }>;
  no_trade_conditions: string[];
  risk_context: string[];
  sizing_policy: {
    mode: 'manual_context_only';
    notes: string[];
  };
  evidence_refs: Array<Record<string, unknown>>;
  reliability_context: Record<string, unknown> | null;
  compile_warnings: string[];
  created_at: string;
}

export interface PlaybookCompileReportResponse {
  version: 'playbook_compile_report.v1';
  eligible: boolean;
  playbook: TradePlaybookResponse | null;
  rejection_reasons: string[];
  warnings: string[];
}
```

## Files

Create:

```text
apps/api/src/playbooks/playbooks.module.ts
apps/api/src/playbooks/playbooks.controller.ts
apps/api/src/playbooks/playbook-compiler.service.ts
apps/api/src/playbooks/playbook.types.ts
apps/web/test/playbook-compiler-layout.test.ts
```

Modify:

```text
apps/api/src/app.module.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
```

## Task 1: Add Playbook Persistence

**Files:**

- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing repository test**

Add:

```ts
test('journal stores trade playbooks by scenario and workspace', async () => {});
```

Expected behavior:

- Save playbook for `scenario_1`.
- List by scenario returns one row.
- Other workspace cannot read it.

- [ ] **Step 2: Add table**

```sql
CREATE TABLE IF NOT EXISTS trade_playbooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    source_scenario_id TEXT NOT NULL,
    source_thesis_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    horizon TEXT NOT NULL DEFAULT 'unknown',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_playbooks_scenario
ON trade_playbooks(workspace_id, source_scenario_id, created_at DESC);
```

- [ ] **Step 3: Add repository methods**

```ts
saveTradePlaybook(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
getTradePlaybook(id: string, workspaceId: string): Promise<JsonRecord | null>;
listTradePlaybooksForScenario(scenarioId: string, workspaceId: string): Promise<JsonRecord[]>;
```

- [ ] **Step 4: Re-run API tests**

Run API typecheck and contract tests.

## Task 2: Implement Strict Compiler

**Files:**

- Create: `apps/api/src/playbooks/playbook-compiler.service.ts`
- Create: `apps/api/src/playbooks/playbook.types.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing compiler tests**

Add tests:

```ts
test('playbook compiler rejects missing invalidation', async () => {});
test('playbook compiler rejects pending hard gates', async () => {});
test('playbook compiler rejects expired runtime decisions', async () => {});
test('playbook compiler compiles valid long scenario', async () => {});
```

- [ ] **Step 2: Implement rejection rules**

Reject when:

- Recommendation action is `wait`, `review`, or `avoid`.
- Runtime decision has blockers.
- Trigger is missing.
- Invalidation is missing.
- Direction is neutral or unknown.
- Market type is missing.
- Evidence refs are empty.
- Scenario is expired or invalidated.
- Hard gates are pending.

- [ ] **Step 3: Implement playbook mapping**

Map:

```text
scenario.id -> source_scenario_id
thesis.id -> source_thesis_id
recommendation.action_bias -> direction
recommendation.required_conditions -> entry.condition
recommendation.invalidation_conditions -> invalidation.condition
recommendation.evidence_refs -> evidence_refs
recommendation.risk_notes + reliability notes -> risk_context
```

- [ ] **Step 4: Re-run compiler tests**

Run API tests.

## Task 3: Add Playbook API

**Files:**

- Create: `apps/api/src/playbooks/playbooks.controller.ts`
- Create: `apps/api/src/playbooks/playbooks.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write route tests**

Add tests:

```ts
test('POST /scenarios/:id/playbook returns rejection report for ineligible scenario', async () => {});
test('POST /scenarios/:id/playbook creates playbook for eligible scenario', async () => {});
test('GET /playbooks/:id is workspace scoped', async () => {});
```

- [ ] **Step 2: Implement routes**

Routes:

```text
POST /scenarios/:id/playbook
GET /scenarios/:id/playbook
GET /playbooks/:id
```

- [ ] **Step 3: Re-run API tests**

Run API typecheck and contract tests.

## Task 4: Add Playbook UI

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Test: `apps/web/test/playbook-compiler-layout.test.ts`

- [ ] **Step 1: Write UI tests**

Assertions:

- Eligible scenario shows `Compile playbook`.
- Ineligible scenario shows rejection reasons.
- Created playbook preview shows entry, invalidation, targets, and no-trade
  conditions.

- [ ] **Step 2: Render compile action**

Action must be a manual research action, not an execution button. Do not use
copy like `Place trade`, `Execute`, or `Auto`.

- [ ] **Step 3: Re-run web tests**

Run web typecheck and focused tests.

## Definition Of Done

- Eligible scenarios compile to persisted playbooks.
- Ineligible scenarios return clear rejection reasons.
- UI exposes playbook preview and rejection state.
- No UI copy implies execution.
- API and web tests pass.

## Follow-Up Version Gate

Do not start V5 until real scenario playbooks exist and the playbook contract is
stable enough to simulate.
