# Visual Scenario Monitoring V7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn scenario decisions and playbooks into chart-backed, live-monitorable research objects without creating order execution semantics.

**Architecture:** V7 hardens scenario condition semantics, adds live-state and event-log contracts, builds a scenario chart projection from existing scenario decision playbooks and trade playbooks, and renders that projection in the web UI. The chart is a derived view over scenario/playbook/runtime data; it is not a separate source of trading truth.

**Tech Stack:** NestJS/TypeScript API, Postgres journal repository, existing `MarketOhlcvService`, React/Vite, TanStack Query, `lightweight-charts`, Node test runner.

---

## Product Scope

V7 answers:

```text
What price area is this scenario watching?
What trigger, invalidation, and target levels matter right now?
Which conditions are passed, failed, pending, or unknown?
Is the scenario still valid, near trigger, triggered, invalidated, expired, or overextended?
What changed in the live state since the last evaluation?
Can the operator inspect the scenario on a candlestick chart without implying an order?
```

V7 is not an order draft system, paper trading engine, broker router, strategy
optimizer, or pattern-recognition clone.

## Existing Inputs

V7 depends on:

```text
scenario_response.v1 fields:
  trigger_spec
  decision_playbook
  scenario_recommendation
  runtime_decision
  latest_playbook
  latest_backtest

scenario_decision_playbook.v1
scenario_runtime_decision.v1
trade_playbook.v1
market-data/ohlcv candles
latest market snapshot
scenario monitor and thesis detail pages
```

Current repo evidence:

```text
apps/api/src/contracts/frontend-contract.ts
apps/api/src/scenarios/scenario-decision.types.ts
apps/api/src/scenarios/scenario-runtime-evaluator.ts
apps/api/src/scenarios/scenarios.service.ts
apps/api/src/playbooks/playbook.types.ts
apps/api/src/playbooks/playbook-compiler.service.ts
apps/api/src/market-data/market-ohlcv.service.ts
apps/web/src/services/market-data.ts
apps/web/src/services/market-realtime.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
```

## Source Of Truth Rules

The source hierarchy is:

```text
Scenario
  Natural-language hypothesis and evidence context.

ScenarioDecisionPlaybook
  Machine-readable monitor contract for watch chart and runtime evaluation.

ScenarioRuntimeDecision
  Latest deterministic evaluation of the decision playbook against market state.

TradePlaybook
  Strict compiled manual trade artifact when the scenario is structured enough.

ScenarioChartProjection
  Derived visual representation. It stores no independent entry, stop, target,
  trigger, or condition truth.
```

Rules:

- Watch chart uses `ScenarioDecisionPlaybook`.
- Trade chart uses `TradePlaybook` only when the playbook is current and not stale.
- Chart projection is rebuilt from source objects.
- Read endpoints do not create playbooks or write events.
- Persistent live events are written only by explicit refresh action or a later worker.
- Missing levels render blockers and unknown overlays, not invented levels.
- `wait`, `review`, and `avoid` scenarios can have watch charts but not executable trade charts.

## New Contract

Add condition roles:

```ts
export type ScenarioDecisionConditionRole =
  | 'watch'
  | 'trigger'
  | 'confirmation'
  | 'entry'
  | 'invalidation'
  | 'target'
  | 'avoid';

export interface ScenarioDecisionCondition {
  id?: string;
  label?: string;
  role?: ScenarioDecisionConditionRole;
  type:
    | 'price_above'
    | 'price_below'
    | 'price_in_zone'
    | 'price_reclaim_level'
    | 'price_reject_level'
    | 'volume_above_average'
    | 'overextended_from_trigger';
  level?: number;
  zone_low?: number;
  zone_high?: number;
  timeframe?: string;
  candle_close_required?: boolean;
  lookback_periods?: number;
  multiplier?: number;
  threshold_pct?: number;
}
```

Extend trade playbook metadata:

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
  compiler_version: 'playbook_compiler.v2';
  source_hashes: {
    scenario: string;
    decision_playbook: string;
    recommendation: string;
    runtime_decision: string;
  };
  status: 'current' | 'stale' | 'superseded';
  stale_reasons: string[];
  created_at: string;
}
```

Add live-state contracts:

```ts
export type ScenarioConditionEvaluationStatus =
  | 'passed'
  | 'failed'
  | 'pending'
  | 'unknown';

export interface ScenarioConditionEvaluationResponse {
  id: string;
  label: string;
  role: ScenarioDecisionConditionRole;
  type: ScenarioDecisionCondition['type'];
  status: ScenarioConditionEvaluationStatus;
  reason: string;
  level: number | null;
  zone_low: number | null;
  zone_high: number | null;
  source: 'decision_playbook' | 'trade_playbook' | 'runtime';
}

export interface ScenarioTargetProgressResponse {
  label: string;
  level: number | null;
  status: 'pending' | 'hit' | 'skipped' | 'unknown';
  hit_at: string | null;
  rationale: string;
}

export interface ScenarioLiveStateResponse {
  version: 'scenario_live_state.v1';
  scenario_id: string;
  workspace_id: string;
  evaluated_at: string;
  current_price: number | null;
  trigger_status: ScenarioRuntimeDecision['trigger_status'];
  validity_status: ScenarioRuntimeDecision['validity_status'];
  recommended_action: ScenarioRuntimeDecision['recommended_action'];
  distance_to_trigger: number | null;
  condition_evaluations: ScenarioConditionEvaluationResponse[];
  target_progress: ScenarioTargetProgressResponse[];
  blockers: string[];
  commentary: string;
  latest_event: ScenarioEventResponse | null;
}

export interface ScenarioEventResponse {
  version: 'scenario_event.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  thesis_id: string | null;
  event_type:
    | 'scenario.generated'
    | 'scenario.near_trigger'
    | 'scenario.triggered'
    | 'scenario.condition_passed'
    | 'scenario.condition_failed'
    | 'scenario.target_hit'
    | 'scenario.weakened'
    | 'scenario.invalidated'
    | 'scenario.expired'
    | 'scenario.overextended';
  event_time: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
}
```

Add chart projection contracts:

```ts
export type ScenarioChartMode =
  | 'watch'
  | 'trade'
  | 'indicator'
  | 'event'
  | 'narrative';

export type ScenarioChartOverlay =
  | {
      id: string;
      type: 'horizontal_line';
      role: 'trigger' | 'entry' | 'invalidation' | 'target' | 'current_price';
      source: 'decision_playbook' | 'trade_playbook' | 'runtime';
      price: number;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    }
  | {
      id: string;
      type: 'price_zone';
      role: 'watch' | 'entry' | 'avoid';
      source: 'decision_playbook' | 'trade_playbook';
      price_low: number;
      price_high: number;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    }
  | {
      id: string;
      type: 'event_marker';
      role: 'event';
      source: 'runtime';
      time: string;
      price: number | null;
      label: string;
      status: 'active' | 'passed' | 'failed' | 'blocked' | 'unknown';
    };

export interface ScenarioChartProjectionResponse {
  version: 'scenario_chart_projection.v1';
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  mode: ScenarioChartMode;
  symbol: string;
  market_type: 'spot' | 'perp';
  interval: MarketChartInterval;
  generated_at: string;
  source_versions: {
    decision_playbook_source: 'llm' | 'derived_v1' | 'missing';
    trade_playbook_id: string | null;
    trade_playbook_status: 'current' | 'stale' | 'superseded' | 'missing';
  };
  candles: MarketOhlcvCandleResponse[];
  overlays: ScenarioChartOverlay[];
  live_state: ScenarioLiveStateResponse;
  warnings: string[];
}
```

## API Surfaces

Add:

```text
GET /scenarios/:id/live
GET /scenarios/:id/events
GET /scenarios/:id/chart?interval=15m&limit=200
POST /scenarios/:id/live/refresh
```

Endpoint rules:

- `GET /scenarios/:id/live` returns derived live state and is read-only.
- `GET /scenarios/:id/events` returns persisted event history.
- `GET /scenarios/:id/chart` returns candles, overlays, and live state.
- `POST /scenarios/:id/live/refresh` evaluates the latest state and writes idempotent events for state transitions.

## Files

Create:

```text
apps/api/src/scenarios/scenario-chart.types.ts
apps/api/src/scenarios/scenario-chart-projection.service.ts
apps/api/src/scenarios/scenario-live-state.service.ts
apps/web/src/components/scenarios/ScenarioChart.tsx
apps/web/src/components/scenarios/scenario-chart-overlays.ts
apps/web/src/services/scenario-chart.ts
apps/web/test/scenario-chart-layout.test.ts
```

Modify:

```text
apps/api/src/scenarios/scenario-decision.types.ts
apps/api/src/scenarios/scenario-runtime-evaluator.ts
apps/api/src/scenarios/scenarios.controller.ts
apps/api/src/scenarios/scenarios.module.ts
apps/api/src/playbooks/playbook.types.ts
apps/api/src/playbooks/playbook-compiler.service.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/package.json
apps/web/src/types/index.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/styles/index.css
```

## Task 1: Add Condition Roles

**Files:**

- Modify: `apps/api/src/scenarios/scenario-decision.types.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing normalization tests**

Add tests that prove condition roles survive API normalization:

```ts
test('scenario condition role is preserved for decision playbook conditions', () => {
  const scenario = toScenarioResponse(
    {
      id: 'scenario_roles_1',
      thesis_id: 'thesis_roles_1',
      scenario_name: 'Breakout watch',
      direction: 'bullish risk',
      condition: 'Watch 110000 reclaim',
      invalidation: 'Invalid below 107800',
      payload: {
        decision_playbook: {
          version: 'scenario_decision_playbook.v1',
          source: 'llm',
          generated_at: '2026-07-02T00:00:00.000Z',
          generated_from_run_id: 'run_roles_1',
          action_bias: 'long',
          confidence: 0.64,
          preferred_action_if_triggered: 'consider_long',
          fallback_action: 'wait',
          near_trigger_threshold_pct: 1,
          validity_window: {
            valid_from: null,
            valid_until: null,
            timeframe: '4h',
            rationale: 'watch breakout',
            refresh_policy: 'manual_review',
          },
          entry_conditions: [
            {
              id: 'watch_zone',
              label: 'Watch zone',
              role: 'watch',
              type: 'price_in_zone',
              zone_low: 109500,
              zone_high: 110200,
            },
            {
              id: 'trigger_close',
              label: 'Close above trigger',
              role: 'trigger',
              type: 'price_above',
              level: 110200,
              candle_close_required: true,
            },
          ],
          avoid_if: [],
          invalidation_conditions: [
            {
              id: 'invalid_low',
              label: 'Invalidation',
              role: 'invalidation',
              type: 'price_below',
              level: 107800,
            },
          ],
          wait_for: [],
          risk_notes: [],
          evidence_refs: [],
          rationale: 'test',
        },
      },
    },
    { id: 'thesis_roles_1', workspace_id: 'workspace_1', symbol: 'BTC/USDT' },
  );

  expect(scenario.decision_playbook?.entry_conditions[0]?.role).toBe('watch');
  expect(scenario.decision_playbook?.entry_conditions[1]?.role).toBe('trigger');
  expect(scenario.decision_playbook?.invalidation_conditions[0]?.role).toBe('invalidation');
});
```

- [ ] **Step 2: Extend condition types**

Add:

```ts
export type ScenarioDecisionConditionRole =
  | 'watch'
  | 'trigger'
  | 'confirmation'
  | 'entry'
  | 'invalidation'
  | 'target'
  | 'avoid';
```

Extend `ScenarioDecisionCondition` in API and web types with:

```ts
id?: string;
label?: string;
role?: ScenarioDecisionConditionRole;
```

- [ ] **Step 3: Preserve role fields during normalization**

In `scenarioDecisionConditionList()`, read and assign:

```ts
const id = nullableString(record.id);
const label = nullableString(record.label);
const role = scenarioDecisionConditionRoleValue(record.role);
if (id !== null) condition.id = id;
if (label !== null) condition.label = label;
if (role !== null) condition.role = role;
```

Add:

```ts
function scenarioDecisionConditionRoleValue(
  value: unknown,
): ScenarioDecisionConditionRole | null {
  const role = stringValue(value);
  if (
    role === 'watch' ||
    role === 'trigger' ||
    role === 'confirmation' ||
    role === 'entry' ||
    role === 'invalidation' ||
    role === 'target' ||
    role === 'avoid'
  ) {
    return role;
  }
  return null;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
API typecheck passes.
The new role preservation test passes.
```

## Task 2: Keep Watch Conditions Out Of Entry Selection

**Files:**

- Modify: `apps/api/src/playbooks/playbook-compiler.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing compiler tests**

Add cases:

```ts
test('playbook compiler does not use watch-only condition as entry', async () => {});
test('playbook compiler accepts role entry condition as entry', async () => {});
test('playbook compiler rejects when only watch and invalidation are present', async () => {});
```

- [ ] **Step 2: Update price entry predicate**

Change `isPriceEntryCondition()` to reject watch-only, confirmation-only, and avoid conditions:

```ts
function isPriceEntryCondition(condition: JsonRecord): boolean {
  const role = String(condition.role ?? '');
  if (role === 'watch' || role === 'confirmation' || role === 'avoid') {
    return false;
  }
  const type = String(condition.type ?? '');
  return (
    role === 'entry' ||
    role === 'trigger' ||
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level'
  );
}
```

- [ ] **Step 3: Make missing-entry rejection explicit**

Keep the existing rejection string but make the source precise:

```ts
hasEntryCandidate ? 'No coherent entry condition.' : 'Missing entry or trigger condition.'
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Compiler rejects watch-only conditions.
Compiler still accepts explicit entry or trigger conditions.
```

## Task 3: Add Playbook Source Hashes And Staleness

**Files:**

- Modify: `apps/api/src/playbooks/playbook.types.ts`
- Modify: `apps/api/src/playbooks/playbook-compiler.service.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing contract tests**

Add tests:

```ts
test('trade playbook response includes compiler version and source hashes', () => {});
test('latest playbook is marked stale when source recommendation hash changes', () => {});
```

- [ ] **Step 2: Add metadata to `TradePlaybookResponse`**

Add:

```ts
compiler_version: 'playbook_compiler.v2';
source_hashes: {
  scenario: string;
  decision_playbook: string;
  recommendation: string;
  runtime_decision: string;
};
status: 'current' | 'stale' | 'superseded';
stale_reasons: string[];
```

- [ ] **Step 3: Add stable JSON hash helper**

Add to `playbook-compiler.service.ts`:

```ts
import { createHash } from 'node:crypto';

function sourceHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(value)))
    .digest('hex')
    .slice(0, 16);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
```

- [ ] **Step 4: Set hashes when compiling**

Add to the playbook payload:

```ts
compiler_version: 'playbook_compiler.v2',
source_hashes: {
  scenario: sourceHash(response.payload),
  decision_playbook: sourceHash(response.decision_playbook),
  recommendation: sourceHash(recommendation),
  runtime_decision: sourceHash(response.runtime_decision),
},
status: 'current',
stale_reasons: [],
```

- [ ] **Step 5: Mark stale on read**

When enriching a scenario, compare the latest playbook hashes against current
scenario, decision playbook, recommendation, and runtime decision. If any hash
differs, return the playbook with:

```ts
status: 'stale',
stale_reasons: [
  'source_decision_playbook_changed',
  'source_recommendation_changed',
]
```

Use only reasons that actually changed.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Compiled playbooks include source metadata.
Stale playbooks are returned as stale instead of current.
```

## Task 4: Add Scenario Live Event Persistence

**Files:**

- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing repository tests**

Add tests:

```ts
test('journal saves scenario events idempotently', async () => {});
test('journal lists scenario events by time for one scenario', async () => {});
test('journal does not leak scenario events across workspaces', async () => {});
```

- [ ] **Step 2: Add table**

Add:

```sql
CREATE TABLE IF NOT EXISTS scenario_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    thesis_id TEXT,
    event_type TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_events_scenario
ON scenario_events(workspace_id, scenario_id, event_time DESC, id DESC);
```

- [ ] **Step 3: Add repository interface methods**

Add:

```ts
saveScenarioEvent(input: JsonRecord, workspaceId: string): Promise<JsonRecord>;
listScenarioEvents(
  scenarioId: string,
  workspaceId: string,
  limit: number,
): Promise<JsonRecord[]>;
```

- [ ] **Step 4: Implement idempotent upsert**

Use:

```sql
INSERT INTO scenario_events
 (id, workspace_id, scenario_id, thesis_id, event_type, event_time, summary, payload_json)
VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb)
ON CONFLICT (id) DO UPDATE SET
  summary = EXCLUDED.summary,
  payload_json = EXCLUDED.payload_json
RETURNING payload_json || jsonb_build_object(
  'id', id,
  'workspace_id', workspace_id,
  'scenario_id', scenario_id,
  'thesis_id', thesis_id,
  'event_type', event_type,
  'event_time', event_time,
  'summary', summary,
  'created_at', created_at
) AS payload_json
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Scenario events persist idempotently and remain workspace scoped.
```

## Task 5: Build Scenario Live State Service

**Files:**

- Create: `apps/api/src/scenarios/scenario-chart.types.ts`
- Create: `apps/api/src/scenarios/scenario-live-state.service.ts`
- Modify: `apps/api/src/scenarios/scenarios.module.ts`
- Modify: `apps/api/src/scenarios/scenarios.controller.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing live-state tests**

Add tests:

```ts
test('scenario live state returns condition evaluations and deterministic commentary', async () => {});
test('scenario live state marks target hit when latest price crosses target', async () => {});
test('scenario live refresh writes invalidation event once', async () => {});
```

- [ ] **Step 2: Add live-state types**

Create `scenario-chart.types.ts` with the contracts from the "New Contract"
section.

- [ ] **Step 3: Implement service**

Create:

```ts
@Injectable()
export class ScenarioLiveStateService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  async getLiveState(
    scenarioId: string,
    workspaceId: string,
  ): Promise<ScenarioLiveStateResponse> {
    const scenario = await this.journal.getScenario(scenarioId, workspaceId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const thesisId = stringValue(scenario.thesis_id);
    const thesis = thesisId
      ? await this.journal.getThesis(thesisId, workspaceId)
      : null;
    const snapshot = await this.journal.getLatestMarketSnapshot(
      stringValue(thesis?.symbol ?? scenario.symbol),
      workspaceId,
    );
    const runtime = evaluateScenarioRuntimeDecision(
      scenario,
      snapshot,
      new Date().toISOString(),
    );
    const events = await this.journal.listScenarioEvents(
      scenarioId,
      workspaceId,
      20,
    );

    return buildScenarioLiveState({
      scenario,
      thesis,
      snapshot,
      runtime,
      events,
    });
  }
}
```

Use local helpers for:

```text
condition_evaluations from decision_playbook and runtime matched/failed lists
target_progress from latest_playbook.targets and current price
commentary from trigger_status, validity_status, blockers, and target progress
latest_event from persisted events[0]
```

- [ ] **Step 4: Implement refresh action**

Add:

```ts
async refreshLiveState(
  scenarioId: string,
  workspaceId: string,
): Promise<ScenarioLiveStateResponse> {
  const state = await this.getLiveState(scenarioId, workspaceId);
  for (const event of eventsFromState(state)) {
    await this.journal.saveScenarioEvent(event as unknown as JsonRecord, workspaceId);
  }
  return this.getLiveState(scenarioId, workspaceId);
}
```

`eventsFromState()` must create deterministic ids:

```ts
function scenarioEventId(input: {
  workspaceId: string;
  scenarioId: string;
  eventType: string;
  eventKey: string;
}): string {
  return `scenario_event_${createHash('sha256')
    .update(`${input.workspaceId}:${input.scenarioId}:${input.eventType}:${input.eventKey}`)
    .digest('hex')
    .slice(0, 24)}`;
}
```

- [ ] **Step 5: Add controller endpoints**

Add:

```ts
@Get(':id/live')
live(@Param('id') id: string, @Headers('x-user-id') userId?: string, @Headers('x-workspace-id') workspaceId?: string) {
  return this.scenarios.getLiveState(id, userId, workspaceId);
}

@Post(':id/live/refresh')
refreshLive(@Param('id') id: string, @Headers('x-user-id') userId?: string, @Headers('x-workspace-id') workspaceId?: string) {
  return this.scenarios.refreshLiveState(id, userId, workspaceId);
}

@Get(':id/events')
events(@Param('id') id: string, @Query('limit') limit?: string, @Headers('x-user-id') userId?: string, @Headers('x-workspace-id') workspaceId?: string) {
  return this.scenarios.listScenarioEvents(id, limit, userId, workspaceId);
}
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Live state endpoints return deterministic state.
Refresh writes state-transition events idempotently.
```

## Task 6: Build Scenario Chart Projection API

**Files:**

- Create: `apps/api/src/scenarios/scenario-chart-projection.service.ts`
- Modify: `apps/api/src/scenarios/scenarios.module.ts`
- Modify: `apps/api/src/scenarios/scenarios.controller.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing projection tests**

Add tests:

```ts
test('scenario chart projection renders watch overlays from decision playbook', async () => {});
test('scenario chart projection renders trade overlays from current trade playbook', async () => {});
test('scenario chart projection excludes stale trade overlays', async () => {});
test('scenario chart projection returns warning when candles are unavailable', async () => {});
```

- [ ] **Step 2: Implement overlay builder**

Rules:

```text
decision_playbook.entry_conditions with role watch -> price_zone watch overlay
decision_playbook.entry_conditions with role trigger -> horizontal_line trigger overlay
decision_playbook.invalidation_conditions -> horizontal_line invalidation overlay
latest_playbook.entry -> trade entry overlay only when status current
latest_playbook.invalidation -> trade invalidation overlay only when status current
latest_playbook.targets -> target line overlays only when status current
latest market current_price -> current_price line overlay when available
scenario_events -> event_marker overlays
```

- [ ] **Step 3: Implement projection service**

Use:

```ts
@Injectable()
export class ScenarioChartProjectionService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly ohlcv: MarketOhlcvService,
    private readonly liveState: ScenarioLiveStateService,
  ) {}

  async getProjection(input: {
    scenarioId: string;
    workspaceId: string;
    interval: string | undefined;
    limit: string | undefined;
  }): Promise<ScenarioChartProjectionResponse> {
    const scenario = await this.journal.getScenario(input.scenarioId, input.workspaceId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const thesis = await this.journal.getThesis(stringValue(scenario.thesis_id), input.workspaceId);
    const symbol = stringValue(thesis?.symbol ?? scenario.symbol);
    const marketType = marketTypeValue(thesis?.market_type ?? scenario.market_type);
    const live = await this.liveState.getLiveState(input.scenarioId, input.workspaceId);
    const candles = await this.ohlcv.getOhlcv({
      workspaceId: input.workspaceId,
      symbol,
      marketType,
      interval: input.interval,
      limit: input.limit,
    });

    return buildScenarioChartProjection({
      scenario,
      thesis,
      candles,
      live,
    });
  }
}
```

- [ ] **Step 4: Add chart endpoint**

Add:

```ts
@Get(':id/chart')
chart(
  @Param('id') id: string,
  @Query('interval') interval?: string,
  @Query('limit') limit?: string,
  @Headers('x-user-id') userId?: string,
  @Headers('x-workspace-id') workspaceId?: string,
) {
  return this.scenarios.getChartProjection(
    { scenarioId: id, interval, limit },
    userId,
    workspaceId,
  );
}
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Chart endpoint returns candles, overlays, live state, warnings, and workspace-scoped data.
```

## Task 7: Add Web Services And Types

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/services/scenario-chart.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Test: `apps/web/test/scenario-chart-layout.test.ts`

- [ ] **Step 1: Add web type tests**

Add tests that import `ScenarioChartProjectionResponse` and create a minimal
valid object with watch and trade overlays.

- [ ] **Step 2: Add types**

Mirror the API contracts:

```ts
export interface ScenarioChartProjectionResponse {
  version: 'scenario_chart_projection.v1';
  workspace_id: string;
  scenario_id: string;
  thesis_id: string;
  mode: ScenarioChartMode;
  symbol: string;
  market_type: 'spot' | 'perp';
  interval: MarketChartInterval;
  generated_at: string;
  source_versions: {
    decision_playbook_source: 'llm' | 'derived_v1' | 'missing';
    trade_playbook_id: string | null;
    trade_playbook_status: 'current' | 'stale' | 'superseded' | 'missing';
  };
  candles: MarketOhlcvCandleResponse[];
  overlays: ScenarioChartOverlay[];
  live_state: ScenarioLiveStateResponse;
  warnings: string[];
}
```

- [ ] **Step 3: Add service functions**

Create:

```ts
export function getScenarioChartProjection(
  scenarioId: string,
  params: { interval?: MarketChartInterval; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioChartProjectionResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/chart`,
    {
      query: {
        interval: params.interval ?? '15m',
        limit: params.limit ?? 200,
      },
    },
    auth,
  );
}

export function refreshScenarioLiveState(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioLiveStateResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/live/refresh`,
    { method: 'POST' },
    auth,
  );
}
```

- [ ] **Step 4: Run web typecheck**

Run:

```powershell
pnpm --dir apps/web typecheck
```

Expected:

```text
Web types compile with scenario chart contracts.
```

## Task 8: Add Scenario Chart Component

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/scenarios/ScenarioChart.tsx`
- Create: `apps/web/src/components/scenarios/scenario-chart-overlays.ts`
- Modify: `apps/web/src/styles/index.css`
- Test: `apps/web/test/scenario-chart-layout.test.ts`

- [ ] **Step 1: Add dependency**

Run:

```powershell
pnpm --dir apps/web add lightweight-charts
```

Expected:

```text
apps/web/package.json and pnpm-lock.yaml update.
```

- [ ] **Step 2: Add layout test**

Add:

```ts
test('scenario chart renders empty state when there are no candles', () => {});
test('scenario chart renders overlay labels without trade action buttons', () => {});
test('scenario chart labels stale playbooks instead of rendering stale trade overlays', () => {});
```

- [ ] **Step 3: Implement chart component**

Component API:

```tsx
type ScenarioChartProps = {
  compact?: boolean;
  projection: ScenarioChartProjectionResponse | null;
  isLoading?: boolean;
};

export function ScenarioChart({
  compact = false,
  projection,
  isLoading = false,
}: ScenarioChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !projection?.candles.length) {
      return;
    }
    const chart = createChart(containerRef.current, {
      height: compact ? 180 : 360,
      layout: {
        background: { color: '#111827' },
        textColor: '#d1d5db',
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(
      projection.candles.map((candle) => ({
        time: Math.floor(new Date(candle.time).getTime() / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    renderScenarioOverlays(chart, candleSeries, projection.overlays);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [compact, projection]);

  if (isLoading) {
    return <div className="scenario-chart-surface">Loading chart...</div>;
  }
  if (!projection || projection.candles.length === 0) {
    return <div className="scenario-chart-surface">Chart unavailable</div>;
  }
  return <div className="scenario-chart-surface" ref={containerRef} />;
}
```

- [ ] **Step 4: Implement overlay rendering**

Use `createPriceLine()` for horizontal overlays:

```ts
series.createPriceLine({
  price: overlay.price,
  color: overlayColor(overlay),
  lineWidth: 1,
  lineStyle: LineStyle.Dashed,
  axisLabelVisible: true,
  title: overlay.label,
});
```

For `price_zone`, render two price lines:

```ts
series.createPriceLine({
  price: overlay.price_low,
  color: overlayColor(overlay),
  lineWidth: 1,
  lineStyle: LineStyle.Dotted,
  axisLabelVisible: true,
  title: `${overlay.label} low`,
});
series.createPriceLine({
  price: overlay.price_high,
  color: overlayColor(overlay),
  lineWidth: 1,
  lineStyle: LineStyle.Dotted,
  axisLabelVisible: true,
  title: `${overlay.label} high`,
});
```

- [ ] **Step 5: Add chart CSS**

Add:

```css
.scenario-chart-surface {
  min-height: 180px;
  width: 100%;
  border: 1px solid var(--border-subtle);
  background: #111827;
}

.scenario-chart-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 6: Run web tests**

Run:

```powershell
pnpm --dir apps/web test -- scenario-chart-layout.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Chart component tests and web typecheck pass.
```

## Task 9: Integrate Chart Into Scenario Surfaces

**Files:**

- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Modify: `apps/web/src/styles/index.css`
- Test: `apps/web/test/scenario-chart-layout.test.ts`
- Test: `apps/web/test/thesis-detail-layout.test.ts`

- [ ] **Step 1: Add failing UI tests**

Add tests:

```ts
test('scenario monitor can render a compact scenario chart', () => {});
test('thesis detail scenario card shows chart status and blockers', () => {});
test('scenario chart has no buy or sell action copy', () => {});
```

- [ ] **Step 2: Fetch chart projection in scenario monitor**

For each rendered card, use a child query:

```tsx
const chartQuery = useQuery({
  enabled: Boolean(item.scenario.id),
  queryKey: ['scenario-chart', item.scenario.id, '15m'],
  queryFn: () =>
    getScenarioChartProjection(
      item.scenario.id!,
      { interval: '15m', limit: 160 },
      auth,
    ),
  refetchInterval: 30_000,
  refetchIntervalInBackground: true,
});
```

- [ ] **Step 3: Render compact chart**

Add inside `ScenarioMonitorCard`:

```tsx
<ScenarioChart
  compact
  projection={chartQuery.data ?? null}
  isLoading={chartQuery.isLoading}
/>
```

- [ ] **Step 4: Fetch chart projection in thesis detail**

Add the same query for expanded scenario cards. Use `enabled` so cards without
ids do not request data.

- [ ] **Step 5: Keep action copy non-executional**

Allowed button labels:

```text
Open chart
Refresh state
Compile playbook
Run backtest
Review blockers
```

Disallowed labels in V7:

```text
Buy
Sell
Place order
Submit order
Auto trade
Arm order
```

- [ ] **Step 6: Run web verification**

Run:

```powershell
pnpm --dir apps/web test -- scenario-chart-layout.test.ts thesis-detail-layout.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Scenario monitor and thesis detail render chart surfaces and avoid execution copy.
```

## Task 10: Final Verification

**Files:**

- Verify all files changed in V7.

- [ ] **Step 1: Run API typecheck**

Run:

```powershell
tsc.CMD -p apps/api/tsconfig.app.json --noEmit
```

Expected:

```text
No TypeScript errors.
```

- [ ] **Step 2: Run API focused tests**

Run:

```powershell
node --test apps/api/test/api-contract.test.ts
```

Expected:

```text
Scenario condition, playbook staleness, live state, event, and chart projection tests pass.
```

- [ ] **Step 3: Run web focused tests**

Run:

```powershell
pnpm --dir apps/web test -- scenario-chart-layout.test.ts thesis-detail-layout.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Scenario chart UI tests and web typecheck pass.
```

- [ ] **Step 4: Run diff hygiene**

Run:

```powershell
git diff --check
```

Expected:

```text
No trailing whitespace or whitespace errors.
```

## Non-Goals

V7 must not implement:

- Order draft persistence.
- Paper order persistence.
- Paper position tracking.
- Broker execution.
- Automated order routing.
- Portfolio risk governor.
- Geometry pattern scanner for triangles, wedges, ABCD, or head-and-shoulders.
- LLM commentary on every price update.
- Chart projection as an independent source of entry, stop, or target truth.

## Exit Criteria To V8

Move to Order Draft V8 only when:

- Condition roles prevent watch zones from becoming entries.
- Runtime evaluator and chart projection agree on trigger and invalidation state.
- Chart projection distinguishes watch overlays from trade overlays.
- Stale playbooks are not rendered as current trade plans.
- Live events can be persisted idempotently.
- UI can show chart, blockers, and current state without execution language.

V8 should introduce:

```text
order_draft.v1
order_analysis_snapshot.v1
user_override_audit.v1
```

V9 should introduce:

```text
paper_order.v1
paper_position.v1
paper_fill_event.v1
paper_pnl_snapshot.v1
```

V8 and V9 should not be started until V7's chart and semantic lifecycle are
stable enough that a draft order can point to an immutable source snapshot.
