# Backtest Lab V5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run reproducible research backtests against persisted trade playbooks with explicit assumptions.

**Architecture:** V5 introduces a backtest resource that consumes `trade_playbook.v1`, historical OHLCV, and an assumption set. It persists inputs, result summary, trade events, and data-quality warnings without mutating scenario evaluations or implying broker accuracy.

**Tech Stack:** NestJS/TypeScript API, Python or TypeScript backtest engine selected by existing repo patterns, journal repository, Postgres persistence, React/Vite UI, Node tests, optional Python tests if engine logic lives in AI-service.

---

## Product Scope

V5 answers:

```text
If this playbook had been applied historically under explicit assumptions,
what would have happened?
How sensitive is the result to fees, slippage, fill policy, and sizing?
Is this playbook worth further research?
```

Backtest Lab does not place orders, optimize strategies, or claim broker-grade
accuracy.

## Existing Inputs

V5 depends on:

```text
trade_playbook.v1
historical OHLCV market data
market type
explicit assumption set
scenario evaluation evidence
```

## New Contract

Add:

```ts
export interface BacktestAssumptionSetResponse {
  version: 'backtest_assumption_set.v1';
  fee_bps: number;
  slippage_bps: number;
  fill_policy: 'touch' | 'close_confirmed' | 'next_open';
  sizing_policy: 'fixed_notional' | 'fixed_fraction';
  starting_equity: number;
  risk_fraction: number | null;
  timeframe: string;
  start_at: string;
  end_at: string;
}

export interface BacktestRunResponse {
  version: 'backtest_run.v1';
  id: string;
  workspace_id: string;
  playbook_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  assumptions: BacktestAssumptionSetResponse;
  result: {
    total_return_pct: number | null;
    max_drawdown_pct: number | null;
    trade_count: number;
    win_rate: number | null;
    profit_factor: number | null;
  };
  warnings: string[];
  data_quality: 'complete' | 'partial' | 'insufficient';
  created_at: string;
  completed_at: string | null;
}
```

## Files

Create:

```text
apps/api/src/backtests/backtests.module.ts
apps/api/src/backtests/backtests.controller.ts
apps/api/src/backtests/backtest.service.ts
apps/api/src/backtests/backtest.types.ts
apps/web/test/backtest-lab-layout.test.ts
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
apps/web/src/pages/ThesisDetailPage.tsx
```

## Task 1: Add Backtest Persistence

**Files:**

- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write repository tests**

Add:

```ts
test('journal stores backtest runs by playbook and workspace', async () => {});
test('journal stores backtest trade events in run order', async () => {});
```

- [ ] **Step 2: Add tables**

```sql
CREATE TABLE IF NOT EXISTS backtest_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    data_quality TEXT NOT NULL DEFAULT 'insufficient',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS backtest_trade_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    backtest_run_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    price DOUBLE PRECISION,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

- [ ] **Step 3: Add repository methods**

```ts
saveBacktestRun(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
getBacktestRun(id: string, workspaceId: string): Promise<JsonRecord | null>;
listBacktestRunsForPlaybook(playbookId: string, workspaceId: string): Promise<JsonRecord[]>;
saveBacktestTradeEvents(runId: string, events: JsonRecord[], workspaceId: string): Promise<void>;
```

- [ ] **Step 4: Re-run API tests**

Run API typecheck and contract tests.

## Task 2: Implement Minimal Backtest Engine

**Files:**

- Create: `apps/api/src/backtests/backtest.service.ts`
- Create: `apps/api/src/backtests/backtest.types.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing engine tests**

Add tests:

```ts
test('backtest requires valid playbook input', async () => {});
test('backtest stores explicit assumptions', async () => {});
test('fee and slippage change backtest result', async () => {});
test('missing OHLCV marks backtest insufficient', async () => {});
```

- [ ] **Step 2: Implement assumptions validation**

Reject assumptions when:

- Fee is negative.
- Slippage is negative.
- Start date is after end date.
- Timeframe is missing.
- Starting equity is less than or equal to zero.

- [ ] **Step 3: Implement simple simulation**

The first engine should:

- Load OHLCV for the playbook symbol and window.
- Detect entry fill based on fill policy.
- Apply fee and slippage to entry and exit prices.
- Exit on invalidation or final candle if no target logic exists.
- Persist warnings for missing target data.

- [ ] **Step 4: Re-run API tests**

Run API tests.

## Task 3: Add Backtest API

**Files:**

- Create: `apps/api/src/backtests/backtests.controller.ts`
- Create: `apps/api/src/backtests/backtests.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write route tests**

Add:

```ts
test('POST /playbooks/:id/backtests creates a backtest run', async () => {});
test('GET /playbooks/:id/backtests lists playbook backtests', async () => {});
test('GET /backtests/:id returns stored assumptions and result', async () => {});
```

- [ ] **Step 2: Implement routes**

Routes:

```text
POST /playbooks/:id/backtests
GET /playbooks/:id/backtests
GET /backtests/:id
```

- [ ] **Step 3: Re-run API tests**

Run API typecheck and contract tests.

## Task 4: Add Backtest UI

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Test: `apps/web/test/backtest-lab-layout.test.ts`

- [ ] **Step 1: Write UI tests**

Assertions:

- Backtest panel shows assumptions.
- Completed result shows total return, max drawdown, trade count, and data
  quality.
- Partial or insufficient result shows warnings before metrics.

- [ ] **Step 2: Render assumptions-first UI**

The result must always show assumptions near the metrics so the user does not
read a number without context.

- [ ] **Step 3: Re-run web tests**

Run web typecheck and focused tests.

## Definition Of Done

- Persisted playbooks can produce reproducible backtest runs.
- Assumptions are stored and visible.
- Missing market data produces partial or insufficient results.
- Fee and slippage affect output.
- UI avoids broker-accuracy claims.

## Follow-Up Version Gate

Do not start V6 until backtest results can be created and inspected from a real
playbook.
