# Scenario Reliability Memory V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate persisted scenario evaluations into compact reliability memory that can inform future research without raw memory injection.

**Architecture:** V3 builds read-optimized reliability profiles from V2 `scenario_evaluation.v1` records. Profiles are grouped by workspace, symbol, market type, horizon, relation to thesis, action bias, and setup type, then exposed to UI and future AI-service prompt handoff as compact digests.

**Tech Stack:** NestJS/TypeScript API, existing journal repository, Postgres aggregate queries, React/Vite UI, AI-service prompt context integration, Node test runner, pytest for AI-service prompt tests.

---

## Product Scope

V3 answers:

```text
How reliable are scenarios like this?
Is there enough sample size to trust the rate?
Which recent lessons should inform future scenario planning?
Should this recommendation be treated cautiously because similar ones failed?
```

V3 does not train a model, optimize trades, or produce broker-like performance.
It produces cautious reliability context.

## Existing Inputs

V3 is built from:

```text
docs/features/scenario-decision-system/v2/implementation-plan.md
apps/api/src/scenarios/scenario-evaluation.types.ts
apps/api/src/scenarios/scenario-evaluation.service.ts
apps/api/src/research-continuity
apps/api/src/workbench/workbench.service.ts
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
```

## New Contract

Add:

```ts
export interface ScenarioReliabilityProfileResponse {
  version: 'scenario_reliability_profile.v1';
  workspace_id: string;
  symbol: string | null;
  market_type: 'spot' | 'perp' | 'mixed';
  horizon: string;
  relation_to_thesis: string;
  action_bias: string;
  setup_type: string | null;
  sample_size: number;
  hit_rate: number | null;
  invalidation_rate: number | null;
  mixed_rate: number | null;
  inconclusive_rate: number | null;
  average_mfe: number | null;
  average_mae: number | null;
  data_quality_notes: string[];
  recent_lessons: string[];
  generated_at: string;
}
```

Rules:

- If `sample_size < 5`, rates must be `null`.
- Inconclusive outcomes must count in the denominator and show a note.
- Spot and perp must not mix unless request explicitly asks for `market_type=mixed`.
- Profiles must be workspace scoped.

## Files

Create:

```text
apps/api/src/scenarios/scenario-reliability.service.ts
apps/api/src/scenarios/scenario-reliability.controller.ts
apps/web/test/scenario-reliability-layout.test.ts
apps/ai-service/tests/test_scenario_reliability_prompt.py
```

Modify:

```text
apps/api/src/scenarios/scenarios.module.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/test/api-contract.test.ts
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/pages/scenario-view-model.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
```

## Task 1: Add Reliability Aggregation Service

**Files:**

- Create: `apps/api/src/scenarios/scenario-reliability.service.ts`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing aggregate tests**

Add tests:

```ts
test('scenario reliability hides rates below minimum sample size', async () => {});
test('scenario reliability separates spot and perp evaluations', async () => {});
test('scenario reliability counts inconclusive outcomes', async () => {});
```

- [ ] **Step 2: Add repository list method**

Add:

```ts
listScenarioEvaluationsForReliability(
  filters: {
    symbol?: string;
    market_type?: string;
    horizon?: string;
    limit: number;
  },
  workspaceId: string,
): Promise<JsonRecord[]>;
```

- [ ] **Step 3: Implement aggregation**

`ScenarioReliabilityService.profile()` should:

- Load evaluations for the workspace.
- Group by symbol, market type, horizon, relation, action bias, and setup type.
- Compute rates only when sample size is at least 5.
- Preserve data quality notes.
- Return recent lessons as concise strings, not raw scenario text.

- [ ] **Step 4: Re-run API tests**

Run:

```powershell
tsc -p apps/api/tsconfig.app.json
node --test ..\..\dist\apps\api\test\api-contract.test.js
```

## Task 2: Add Reliability API

**Files:**

- Create: `apps/api/src/scenarios/scenario-reliability.controller.ts`
- Modify: `apps/api/src/scenarios/scenarios.module.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests:

```ts
test('GET /scenario-reliability returns workspace scoped profiles', async () => {});
test('GET /scenario-reliability/:symbol filters by normalized symbol', async () => {});
```

- [ ] **Step 2: Implement routes**

Routes:

```text
GET /scenario-reliability
GET /scenario-reliability/:symbol
POST /scenario-reliability/rebuild
```

`POST /scenario-reliability/rebuild` may synchronously rebuild profiles in V3 if
the data set is small. Add a background job only if tests prove the synchronous
path is too slow.

- [ ] **Step 3: Re-run API tests**

Run API typecheck and contract tests.

## Task 3: Surface Reliability In Scenario UI

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/pages/scenario-view-model.ts`
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Test: `apps/web/test/scenario-reliability-layout.test.ts`

- [ ] **Step 1: Add UI tests**

Assertions:

- Low sample profile renders `Not enough history`.
- Complete sample profile renders `Reliability 62%` or equivalent compact
  label.
- Inconclusive-heavy profile renders data quality warning.

- [ ] **Step 2: Add view model fields**

Add:

```ts
reliabilityLabel: string;
reliabilityTone: 'constructive' | 'warning' | 'risk' | 'muted';
reliabilityNotes: string[];
```

- [ ] **Step 3: Render compact chips**

Scenario cards should show reliability as supporting context, not as the primary
action. The primary action remains runtime decision/recommendation.

- [ ] **Step 4: Re-run web tests**

Run:

```powershell
tsc -p apps/web/tsconfig.json --noEmit
node --test --experimental-strip-types --experimental-default-type=module test/scenario-reliability-layout.test.ts test/scenario-monitor-layout.test.ts test/thesis-detail-layout.test.ts
```

## Task 4: Add Compact Reliability Memory To AI-Service Context

**Files:**

- Modify: `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`
- Modify: `apps/ai-service/luna_workstation/agents/planners/scenario_planner.py`
- Test: `apps/ai-service/tests/test_scenario_reliability_prompt.py`

- [ ] **Step 1: Write failing prompt tests**

Test that prompt context includes compact lessons and excludes raw old scenario
text:

```python
def test_scenario_reliability_prompt_uses_compact_digest_only():
    prompt = build_prompt_with_reliability_digest(
        {
            "sample_size": 8,
            "recent_lessons": ["Short-term reclaim scenarios often need volume confirmation."],
            "raw_scenarios": ["do not include this full old scenario"],
        }
    )
    assert "Short-term reclaim scenarios often need volume confirmation." in prompt
    assert "do not include this full old scenario" not in prompt
```

- [ ] **Step 2: Add digest renderer**

Renderer should output no more than five lessons and include sample-size warning.

- [ ] **Step 3: Re-run AI-service tests**

Run:

```powershell
node scripts/python.cjs -m pytest tests/test_scenario_reliability_prompt.py tests/test_structured_agents.py
node scripts/python.cjs -m mypy luna_workstation
```

## Definition Of Done

- Reliability profiles are workspace scoped.
- Low sample size hides rates.
- Inconclusive outcomes remain visible.
- Scenario UI shows reliability as context.
- AI-service receives only compact reliability digest.

## Follow-Up Version Gate

Do not start V4 until profiles exist and the UI can show why a reliability
number is or is not trustworthy.
