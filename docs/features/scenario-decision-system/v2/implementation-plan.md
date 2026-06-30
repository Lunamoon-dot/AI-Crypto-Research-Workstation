# Scenario Evaluation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist deterministic scenario outcomes after each recommendation's evaluation window matures.

**Architecture:** V2 adds scenario evaluation as a durable API concern beside existing thesis calibration. It consumes `scenario_recommendation.evaluation_window`, scenario trigger/invalidation structure, and market OHLCV to produce auditable `scenario_evaluation.v1` records without changing Scenario Planner behavior.

**Tech Stack:** NestJS/TypeScript API, existing journal repository abstraction, Postgres plus fake repository tests, existing market-data services, React/Vite UI, Node test runner.

---

## Product Scope

V2 turns V1 evaluation readiness into persisted scenario outcomes.

The operator should be able to answer:

```text
The scenario horizon ended. Did the recommendation work?
Was the trigger hit?
Was invalidation hit first?
Was the result useful, missed, mixed, or inconclusive?
Which market data was used?
```

V2 does not build backtests, playbook compilation, position sizing, or broker
PnL. It is research-quality outcome evaluation.

## Existing Inputs

V2 is built from:

```text
docs/features/scenario-decision-system/README.md
docs/features/scenario-decision-system/v1/implementation-plan.md
apps/api/src/scenarios/scenario-decision.types.ts
apps/api/src/scenarios/scenario-runtime-evaluator.ts
apps/api/src/scenarios/scenario-evaluator.ts
apps/api/src/scenarios/scenarios.service.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/pages/scenario-view-model.ts
```

## New Contract

Add `scenario_evaluation.v1` beside existing scenario decision types.

```ts
export type ScenarioEvaluationResult =
  | 'hit'
  | 'invalidated'
  | 'missed'
  | 'mixed'
  | 'inconclusive';

export type ScenarioEvaluationDataQuality =
  | 'complete'
  | 'partial'
  | 'insufficient';

export interface ScenarioEvaluationResponse {
  version: 'scenario_evaluation.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  research_run_id: string | null;
  symbol: string;
  market_type: 'spot' | 'perp';
  horizon: string;
  evaluated_at: string;
  evaluation_window: {
    starts_at: string | null;
    ends_at: string | null;
  };
  result: ScenarioEvaluationResult;
  trigger_hit: boolean | null;
  invalidation_hit: boolean | null;
  target_hit: boolean | null;
  start_price: number | null;
  end_price: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  data_quality: ScenarioEvaluationDataQuality;
  warnings: string[];
  evidence: Record<string, unknown>;
}
```

## New API Surfaces

Add evaluation routes only after the storage and service layer exists:

```text
GET /scenarios/:id/evaluations
POST /scenarios/:id/evaluations
GET /scenario-evaluations/:id
```

`GET /scenarios/monitor` and `GET /theses/:id/scenarios` should continue to
embed latest evaluation summary when available.

## Files

Create:

```text
apps/api/src/scenarios/scenario-evaluation.types.ts
apps/api/src/scenarios/scenario-evaluation.service.ts
apps/api/src/scenarios/scenario-evaluations.controller.ts
apps/web/test/scenario-evaluation-layout.test.ts
```

Modify:

```text
apps/api/src/scenarios/scenario-decision.types.ts
apps/api/src/scenarios/scenarios.module.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/database/postgres-journal.repository.ts
apps/api/test/api-contract.test.ts
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/pages/scenario-view-model.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
```

## Task 1: Add Scenario Evaluation Contract

**Files:**

- Create: `apps/api/src/scenarios/scenario-evaluation.types.ts`
- Modify: `apps/api/src/scenarios/scenario-decision.types.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing contract test**

Add a test that creates a scenario evaluation object and asserts normalization
preserves the stable fields:

```ts
test('scenario evaluation response preserves result and evidence fields', () => {
  const evaluation = toScenarioEvaluationResponse({
    id: 'eval_btc_reclaim',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_btc_reclaim',
    thesis_id: 'thesis_btc',
    research_run_id: 'run_btc',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    horizon: 'short_term',
    evaluated_at: '2026-07-01T00:00:00.000Z',
    evaluation_window: {
      starts_at: '2026-06-29T00:00:00.000Z',
      ends_at: '2026-07-01T00:00:00.000Z',
    },
    result: 'hit',
    trigger_hit: true,
    invalidation_hit: false,
    target_hit: null,
    start_price: 61000,
    end_price: 63200,
    max_favorable_excursion: 0.045,
    max_adverse_excursion: 0.012,
    data_quality: 'complete',
    warnings: [],
    evidence: { trigger_price: 62000 },
  });

  assert.equal(evaluation.version, 'scenario_evaluation.v1');
  assert.equal(evaluation.result, 'hit');
  assert.equal(evaluation.data_quality, 'complete');
  assert.equal(evaluation.evidence.trigger_price, 62000);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
tsc -p apps/api/tsconfig.app.json
node --test ..\..\dist\apps\api\test\api-contract.test.js
```

Expected: fail because `toScenarioEvaluationResponse` does not exist.

- [ ] **Step 3: Add contract type and normalizer**

Create `scenario-evaluation.types.ts` with the response types above. Add a
normalizer in `frontend-contract.ts` that:

- Accepts records only when required ids are present.
- Defaults invalid result to `inconclusive`.
- Defaults invalid data quality to `insufficient`.
- Preserves `evidence` as an object.
- Normalizes warning arrays to strings.

- [ ] **Step 4: Re-run API contract test**

Run the same commands. Expected: the new contract test passes.

## Task 2: Add Scenario Evaluation Persistence

**Files:**

- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing repository test**

Add a fake repository test that saves and lists evaluations by scenario id:

```ts
test('journal stores scenario evaluations by scenario and workspace', async () => {
  const { journal } = buildHarness();
  await journal.saveScenarioEvaluation({
    id: 'scenario_eval_1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_1',
    thesis_id: 'thesis_1',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    result: 'hit',
    data_quality: 'complete',
    evidence: { trigger_hit_at: '2026-07-01T00:00:00.000Z' },
  }, 'workspace_a');

  const rows = await journal.listScenarioEvaluations('scenario_1', 'workspace_a');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.result, 'hit');
  assert.deepEqual(rows[0]?.evidence, {
    trigger_hit_at: '2026-07-01T00:00:00.000Z',
  });
});
```

- [ ] **Step 2: Add repository interface methods**

Add to `JournalRepository`:

```ts
saveScenarioEvaluation(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
listScenarioEvaluations(scenarioId: string, workspaceId: string): Promise<JsonRecord[]>;
getScenarioEvaluation(id: string, workspaceId: string): Promise<JsonRecord | null>;
```

- [ ] **Step 3: Add Postgres table**

Add table:

```sql
CREATE TABLE IF NOT EXISTS scenario_evaluations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    thesis_id TEXT NOT NULL,
    research_run_id TEXT,
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL DEFAULT 'spot',
    horizon TEXT NOT NULL DEFAULT 'unknown',
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    evaluation_window JSONB NOT NULL DEFAULT '{}'::jsonb,
    result TEXT NOT NULL,
    trigger_hit BOOLEAN,
    invalidation_hit BOOLEAN,
    target_hit BOOLEAN,
    start_price DOUBLE PRECISION,
    end_price DOUBLE PRECISION,
    max_favorable_excursion DOUBLE PRECISION,
    max_adverse_excursion DOUBLE PRECISION,
    data_quality TEXT NOT NULL DEFAULT 'insufficient',
    warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_evaluations_scenario
ON scenario_evaluations(workspace_id, scenario_id, evaluated_at DESC);
```

- [ ] **Step 4: Implement fake and Postgres repository methods**

Fake repository should use a `Map<string, JsonRecord>` keyed by
`workspace_id:id`. Postgres repository should write JSON fields with `::jsonb`
casts and always filter by `workspace_id`.

- [ ] **Step 5: Re-run API contract tests**

Run:

```powershell
tsc -p apps/api/tsconfig.app.json
node --test ..\..\dist\apps\api\test\api-contract.test.js
```

Expected: repository tests pass.

## Task 3: Implement Deterministic Evaluation Service

**Files:**

- Create: `apps/api/src/scenarios/scenario-evaluation.service.ts`
- Modify: `apps/api/src/scenarios/scenarios.module.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing service tests**

Add tests for four cases:

```ts
test('scenario evaluation marks hit when trigger occurs before invalidation', async () => {});
test('scenario evaluation marks invalidated when invalidation occurs first', async () => {});
test('scenario evaluation marks missed when window ends without trigger', async () => {});
test('scenario evaluation marks inconclusive when OHLCV is missing', async () => {});
```

Each test should seed a scenario with:

- `scenario_recommendation.evaluation_window`.
- Trigger condition.
- Invalidation condition.
- Market type.

Use a stub OHLCV provider or existing market data service fake to provide
candles.

- [ ] **Step 2: Implement `ScenarioEvaluationService.evaluateScenario`**

The service should:

- Load scenario and thesis inside workspace.
- Resolve evaluation window.
- Fetch OHLCV for the symbol and window.
- Evaluate trigger and invalidation order.
- Compute start price, end price, MFE, and MAE when candle data exists.
- Persist the evaluation record.

- [ ] **Step 3: Define result rules**

Use these initial rules:

```text
hit          trigger hit and invalidation not hit before trigger
invalidated  invalidation hit before trigger
missed       no trigger and enough data covers the window
mixed        trigger hit, then invalidation hit before target/follow-through
inconclusive missing trigger, invalidation, or sufficient OHLCV
```

- [ ] **Step 4: Re-run tests**

Run API contract tests and ensure all new evaluation result cases pass.

## Task 4: Add Evaluation Routes

**Files:**

- Create: `apps/api/src/scenarios/scenario-evaluations.controller.ts`
- Modify: `apps/api/src/scenarios/scenarios.module.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests:

```ts
test('POST /scenarios/:id/evaluations evaluates a workspace scenario', async () => {});
test('GET /scenarios/:id/evaluations lists evaluations for one scenario', async () => {});
test('GET /scenario-evaluations/:id is workspace scoped', async () => {});
```

- [ ] **Step 2: Implement controller**

Controller should expose:

```ts
@Controller()
export class ScenarioEvaluationsController {
  @Post('scenarios/:id/evaluations')
  evaluateScenario(...) {}

  @Get('scenarios/:id/evaluations')
  listForScenario(...) {}

  @Get('scenario-evaluations/:id')
  getEvaluation(...) {}
}
```

- [ ] **Step 3: Update OpenAPI contract**

Regenerate or manually update the generated contract according to existing repo
practice.

- [ ] **Step 4: Re-run API tests**

Run API typecheck and contract tests.

## Task 5: Surface Latest Evaluation In Existing Scenario UI

**Files:**

- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
- Modify: `apps/api/src/theses/theses.service.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/pages/scenario-view-model.ts`
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Test: `apps/web/test/scenario-monitor-layout.test.ts`
- Test: `apps/web/test/thesis-detail-layout.test.ts`

- [ ] **Step 1: Add failing UI tests**

Add assertions that:

- Scenario Monitor renders `Evaluation: hit` for evaluated scenarios.
- Thesis Detail renders `Evaluation due` for scenarios with ended windows and no
  evaluation.
- Inconclusive evaluations display a warning.

- [ ] **Step 2: Extend `ScenarioResponse`**

Add:

```ts
latest_evaluation: ScenarioEvaluationResponse | null;
evaluation_state: 'not_ready' | 'pending' | 'due' | 'evaluated' | 'inconclusive';
```

- [ ] **Step 3: Update view model**

`scenario-view-model.ts` should map evaluation state into compact labels:

```text
not_ready -> Not ready
pending -> Pending
due -> Evaluation due
evaluated -> Evaluated
inconclusive -> Inconclusive
```

- [ ] **Step 4: Re-run web tests**

Run:

```powershell
tsc -p apps/web/tsconfig.json --noEmit
node --test --experimental-strip-types --experimental-default-type=module test/scenario-monitor-layout.test.ts test/thesis-detail-layout.test.ts
```

## Definition Of Done

- Scenario evaluations persist and are workspace scoped.
- Scenario Monitor and Thesis Detail show latest evaluation state.
- Evaluation outcomes are deterministic and auditable.
- Missing data becomes `inconclusive`, not a hidden pass/fail.
- API and web focused tests pass.

## Follow-Up Version Gate

Do not start V3 until V2 has real persisted scenario evaluations and at least
one UI surface where operators can inspect result and data quality.
