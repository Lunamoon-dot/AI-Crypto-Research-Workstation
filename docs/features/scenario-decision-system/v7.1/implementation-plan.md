# Scenario Lifecycle Hardening V7.1 Implementation Plan

Status: goal-ready
Last updated: 2026-07-02

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden V7 visual scenario monitoring so scenario live state, chart projection, playbook freshness, event history, and cross-system feedback are stable enough to support future order-draft work.

**Architecture:** V7.1 keeps V7's source-of-truth hierarchy but replaces prototype-style current-state shortcuts with durable semantic boundaries. Runtime state remains derived from market data, trade playbooks remain manual-context artifacts, chart projection stays read-only, and continuity/signal feedback flows through compact evaluated artifacts instead of raw prompt injection.

**Tech Stack:** NestJS/TypeScript API, Postgres journal repository, existing market OHLCV services, React/Vite, TanStack Query, `lightweight-charts`, Node test runner, Python ai-service continuity and scenario planner contracts.

---

## Product Scope

V7.1 answers:

```text
Can the chart/live-state layer be trusted as scenario monitoring state?
Can event history explain transitions without rewriting the past?
Can stale trade overlays be blocked without false positives from volatile runtime fields?
Can the monitor scale beyond a handful of scenarios?
Can future order drafts freeze a stable scenario/playbook snapshot?
Can future runs receive compact evaluated lessons without raw continuity noise?
```

V7.1 is a hardening release. It must not create:

```text
order_draft.v1
paper_order.v1
paper_position.v1
broker execution
automatic order routing
```

## Preconditions

V7.1 assumes V7 introduced or touched:

```text
scenario_condition_role.v1
scenario_live_state.v1
scenario_event.v1
scenario_chart_projection.v1
trade_playbook.v1 source_hashes
GET /scenarios/:id/live
GET /scenarios/:id/events
GET /scenarios/:id/chart
POST /scenarios/:id/live/refresh
ScenarioChart
```

If V7 implementation differs from those names, update this plan by mapping the existing names first, then keep the behavior unchanged.

## Source Of Truth Rules

V7.1 locks these rules:

- Scenario, decision playbook, recommendation, and trade playbook are structural sources.
- Current price, distance to trigger, target progress, and `evaluated_at` are volatile runtime state.
- Volatile runtime state must not make a structurally unchanged trade playbook stale.
- Event history records transitions and occurrences. It is not a mutable current-state cache.
- Current live state can be snapshotted separately from event history.
- Chart overlays are derived from scenario, playbook, candles, live state, and events.
- Monitor list cards should render summaries by default, not full OHLCV charts for every scenario.
- Continuity can store history, but prompt context should use compact evaluated feedback only.

## New Or Hardened Contracts

### Playbook Freshness Contract

Keep `trade_playbook.v1` backward compatible. Do not rename existing fields.

Add or normalize:

```ts
export type TradePlaybookStatus =
  | 'current'
  | 'stale'
  | 'superseded'
  | 'unverifiable';

export type TradePlaybookStaleReason =
  | 'source_scenario_changed'
  | 'source_decision_playbook_changed'
  | 'source_recommendation_changed'
  | 'legacy_playbook_without_source_hashes';

export interface TradePlaybookSourceHashes {
  scenario: string;
  decision_playbook: string;
  recommendation: string;
  runtime_decision: string;
}
```

`runtime_decision` remains in the hash object for compatibility, but V7.1 must hash only stable runtime contract fields:

```text
version
playbook_source
preferred_action_if_triggered
fallback_action
hard_gate_ids
condition_ids
validity_window
```

Do not include:

```text
evaluated_at
current_price
distance_to_trigger
status_reason
commentary
matched_conditions
failed_conditions
target_progress
```

### Transition Event Contract

Persist transitions as occurrence events:

```ts
export interface ScenarioTransitionEventPayload {
  entity_id: string;
  entity_type: 'scenario' | 'condition' | 'target';
  from_status: string | null;
  to_status: string;
  market_snapshot_id: string | null;
  evaluated_at: string;
  current_price: number | null;
}
```

Event identity must include occurrence evidence:

```text
workspace_id
scenario_id
market_snapshot_id or evaluated_at bucket
entity_id
from_status
to_status
event_type
```

Historical events are immutable. Repeated writes for the same occurrence should be `ON CONFLICT DO NOTHING`.

### Live State Snapshot Contract

Add a separate current-state snapshot row when durable current state is needed:

```ts
export interface ScenarioLiveStateSnapshotResponse {
  version: 'scenario_live_state_snapshot.v1';
  id: string;
  workspace_id: string;
  scenario_id: string;
  market_snapshot_id: string | null;
  evaluated_at: string;
  state: ScenarioLiveStateResponse;
  source_hash: string;
  created_at: string;
}
```

### Condition Evaluation Context

Runtime condition evaluation must use a structured context:

```ts
export interface ScenarioConditionEvaluationContext {
  currentPrice: number | null;
  evaluatedAt: string;
  marketSnapshotId: string | null;
  closedCandlesByInterval: Partial<Record<MarketChartInterval, MarketOhlcvCandleResponse[]>>;
}
```

Unknown is safer than false precision:

```text
not enough data -> unknown
unknown confirmation gate -> block strong action
candle_close_required -> use closed candle only
volume_above_average -> require enough lookback candles
reclaim/reject -> require a crossing or rejection sequence
```

### Chart Projection Summary

Add a lightweight summary for monitor lists:

```ts
export interface ScenarioChartSummaryResponse {
  version: 'scenario_chart_summary.v1';
  workspace_id: string;
  scenario_id: string;
  mode: ScenarioChartMode;
  symbol: string;
  market_type: 'spot' | 'perp';
  generated_at: string;
  trigger_status: ScenarioLiveStateResponse['trigger_status'];
  validity_status: ScenarioLiveStateResponse['validity_status'];
  trade_playbook_status: TradePlaybookStatus | 'missing';
  blocker_count: number;
  warning_count: number;
  overlay_counts: {
    watch: number;
    trigger: number;
    entry: number;
    invalidation: number;
    target: number;
    event: number;
  };
  latest_event: ScenarioEventResponse | null;
}
```

Full chart endpoint still returns candles and overlays. Monitor cards should request summaries unless the chart is visible or expanded.

### Scenario Feedback Playbook

Add a compact cross-run feedback artifact before raw continuity enters future planning:

```ts
export interface ScenarioFeedbackPlaybookResponse {
  version: 'scenario_feedback_playbook.v1';
  workspace_id: string;
  symbol: string;
  generated_at: string;
  source_evaluation_ids: string[];
  source_signal_report_ids: string[];
  lessons: Array<{
    id: string;
    scope: 'scenario' | 'signal' | 'playbook' | 'data_quality';
    horizon: string;
    market_type: 'spot' | 'perp' | 'unknown';
    statement: string;
    confidence: 'low' | 'medium' | 'high';
    evidence_count: number;
  }>;
  gates: Array<{
    id: string;
    reason: string;
    applies_to: 'entry' | 'confirmation' | 'invalidation' | 'playbook_compile';
  }>;
  exclusions: string[];
}
```

Only Portfolio Manager or an explicit feedback builder should create this artifact. Scenario Planner consumes this compact artifact, not raw `latest_continuity_context`.

## Files

Create:

```text
apps/api/src/playbooks/playbook-freshness.ts
apps/api/src/scenarios/scenario-condition-evaluator.ts
apps/api/src/scenarios/scenario-live-transitions.ts
apps/api/src/scenarios/scenario-context-loader.service.ts
apps/api/src/scenarios/scenario-chart-summary.service.ts
apps/api/src/scenarios/scenario-feedback-playbook.service.ts
apps/web/test/scenario-chart-behavior.test.ts
```

Modify:

```text
apps/api/src/playbooks/playbook-source-hash.ts
apps/api/src/playbooks/playbook.types.ts
apps/api/src/playbooks/playbook-compiler.service.ts
apps/api/src/scenarios/scenario-live-state.service.ts
apps/api/src/scenarios/scenario-chart-projection.service.ts
apps/api/src/scenarios/scenario-chart.types.ts
apps/api/src/scenarios/scenario-runtime-evaluator.ts
apps/api/src/scenarios/scenarios.controller.ts
apps/api/src/scenarios/scenarios.service.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-schema.sql
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/components/scenarios/ScenarioChart.tsx
apps/web/src/components/scenarios/scenario-chart-overlays.ts
apps/web/src/pages/ScenarioMonitorPage.tsx
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/services/scenario-chart.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
apps/web/src/styles/index.css
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/agents/planners/scenario_planner.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/tests/test_portfolio_manager.py
apps/ai-service/tests/test_structured_agents.py
docs/features/scenario-decision-system/README.md
docs/known-issues.md
docs/project-status.md
```

## Task 1: Stabilize Playbook Freshness

**Files:**

- Create: `apps/api/src/playbooks/playbook-freshness.ts`
- Modify: `apps/api/src/playbooks/playbook-source-hash.ts`
- Modify: `apps/api/src/playbooks/playbook.types.ts`
- Modify: `apps/api/src/scenarios/scenario-live-state.service.ts`
- Modify: `apps/api/src/scenarios/scenario-chart-projection.service.ts`
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
- Modify: `apps/api/src/theses/theses.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing freshness tests**

Add these tests to `apps/api/test/api-contract.test.ts`:

```ts
test('trade playbook stays current when only runtime evaluated_at changes', async () => {
  const { journal, playbooks, scenarios } = buildHarness();
  const { thesisId, scenarioId } = seedPlayableScenario(journal, {
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
    currentPrice: 100_000,
  });

  const compiled = await playbooks.compileForScenario(scenarioId, 'user_1', 'workspace_a');
  assert.equal(compiled.playbook?.status, 'current');

  journal.marketSnapshots.set(key('snap_btc_later', 'workspace_a'), {
    id: 'snap_btc_later',
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    current_price: 100_100,
    captured_at: new Date(Date.now() + 60_000).toISOString(),
    source: 'test',
  });

  const detail = await scenarios.forThesis(thesisId, 'user_1', 'workspace_a');
  assert.equal(detail[0]?.latest_playbook?.status, 'current');
  assert.deepEqual(detail[0]?.latest_playbook?.stale_reasons, []);
});

test('legacy trade playbook without source hashes is unverifiable', async () => {
  const { journal, scenarios } = buildHarness();
  const { thesisId, scenarioId } = seedPlayableScenario(journal, {
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
    currentPrice: 100_000,
  });

  journal.tradePlaybooks.set(key('legacy_playbook_no_hash', 'workspace_a'), {
    id: 'legacy_playbook_no_hash',
    workspace_id: 'workspace_a',
    source_scenario_id: scenarioId,
    source_thesis_id: thesisId,
    version: 'trade_playbook.v1',
    symbol: 'BTC/USDT',
    market_type: 'spot',
    direction: 'long',
    horizon: 'short_term',
    entry: { type: 'level', condition: 'break above', level: 100000, zone_low: null, zone_high: null },
    invalidation: { condition: 'below 99000', level: 99000 },
    targets: [{ label: 'Target 1', level: 103000, rationale: 'test' }],
    no_trade_conditions: [],
    risk_context: [],
    sizing_policy: { mode: 'manual_context_only', notes: [] },
    evidence_refs: [],
    reliability_context: null,
    compile_warnings: [],
    created_at: new Date().toISOString(),
  });

  const detail = await scenarios.forThesis(thesisId, 'user_1', 'workspace_a');
  assert.equal(detail[0]?.latest_playbook?.status, 'unverifiable');
  assert.deepEqual(detail[0]?.latest_playbook?.stale_reasons, [
    'legacy_playbook_without_source_hashes',
  ]);
});
```

- [ ] **Step 2: Create a single freshness evaluator**

Create `apps/api/src/playbooks/playbook-freshness.ts`:

```ts
import type { JsonRecord } from '../database/journal.types';
import { playbookSourceHashes } from './playbook-source-hash';
import type { TradePlaybookResponse } from './playbook.types';

export type PlaybookFreshnessSources = {
  scenario: unknown;
  decisionPlaybook: unknown;
  recommendation: unknown;
  runtimeDecision: unknown;
};

export function evaluateTradePlaybookFreshness(
  playbook: TradePlaybookResponse,
  sources: PlaybookFreshnessSources,
): TradePlaybookResponse {
  const storedHashes = recordValue(playbook.source_hashes);
  if (Object.keys(storedHashes).length === 0) {
    return {
      ...playbook,
      status: 'unverifiable',
      stale_reasons: ['legacy_playbook_without_source_hashes'],
    };
  }

  const currentHashes = playbookSourceHashes(sources);
  const stale_reasons: string[] = [];
  addReason(stale_reasons, storedHashes.scenario, currentHashes.scenario, 'source_scenario_changed');
  addReason(stale_reasons, storedHashes.decision_playbook, currentHashes.decision_playbook, 'source_decision_playbook_changed');
  addReason(stale_reasons, storedHashes.recommendation, currentHashes.recommendation, 'source_recommendation_changed');

  if (stale_reasons.length === 0) {
    return { ...playbook, status: 'current', stale_reasons: [] };
  }
  return { ...playbook, status: 'stale', stale_reasons };
}

function addReason(reasons: string[], stored: unknown, current: string, reason: string): void {
  if (typeof stored !== 'string' || stored !== current) {
    reasons.push(reason);
  }
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
```

- [ ] **Step 3: Exclude volatile runtime fields from source hashes**

Modify `apps/api/src/playbooks/playbook-source-hash.ts`:

```ts
export function playbookSourceHashes(input: {
  scenario: unknown;
  decisionPlaybook: unknown;
  recommendation: unknown;
  runtimeDecision: unknown;
}): TradePlaybookResponse['source_hashes'] {
  return {
    scenario: sourceHash(stableScenarioSource(input.scenario)),
    decision_playbook: sourceHash(input.decisionPlaybook),
    recommendation: sourceHash(input.recommendation),
    runtime_decision: sourceHash(stableRuntimeDecisionSource(input.runtimeDecision)),
  };
}

function stableScenarioSource(value: unknown): unknown {
  const record = recordValue(value);
  return omitKeys(record, ['runtime_decision', 'last_evaluated_at', 'distance_to_trigger', 'status_reason']);
}

function stableRuntimeDecisionSource(value: unknown): unknown {
  const record = recordValue(value);
  return pickKeys(record, [
    'version',
    'playbook_source',
    'preferred_action_if_triggered',
    'fallback_action',
    'validity_window',
  ]);
}

function pickKeys(record: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function omitKeys(record: JsonRecord, keys: string[]): JsonRecord {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
```

- [ ] **Step 4: Replace duplicate current-playbook logic**

Replace local `currentPlaybook()` helpers in scenario, chart, thesis, and live-state services with:

```ts
const latestPlaybook = rawPlaybook
  ? evaluateTradePlaybookFreshness(toTradePlaybookResponse(rawPlaybook), {
      scenario: scenarioResponse.payload,
      decisionPlaybook: scenarioResponse.decision_playbook,
      recommendation: scenarioResponse.scenario_recommendation,
      runtimeDecision: scenarioResponse.runtime_decision,
    })
  : null;
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "trade playbook stays current|legacy trade playbook"
```

Expected:

```text
Both freshness tests pass.
No TypeScript errors.
```

## Task 2: Replace Current-State Events With Transition Events

**Files:**

- Create: `apps/api/src/scenarios/scenario-live-transitions.ts`
- Modify: `apps/api/src/scenarios/scenario-live-state.service.ts`
- Modify: `apps/api/src/scenarios/scenario-chart.types.ts`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing transition tests**

Add tests:

```ts
test('scenario transition events preserve repeated passed failed passed occurrences', async () => {
  const { journal, liveState } = buildHarness();
  const scenarioId = 'scenario_transition_repeats';
  seedTransitionScenario(journal, scenarioId, 'workspace_a');

  await refreshWithSnapshot(journal, liveState, scenarioId, 'workspace_a', 'snap_a', 101);
  await refreshWithSnapshot(journal, liveState, scenarioId, 'workspace_a', 'snap_b', 99);
  await refreshWithSnapshot(journal, liveState, scenarioId, 'workspace_a', 'snap_c', 102);

  const events = await journal.listScenarioEvents(scenarioId, 'workspace_a', 20);
  assert.equal(events.filter((event) => event.event_type === 'scenario.condition_passed').length, 2);
  assert.equal(events.filter((event) => event.event_type === 'scenario.condition_failed').length, 1);
});

test('scenario transition event payload does not mutate historical event_time', async () => {
  const { journal } = buildHarness();
  await journal.saveScenarioEvent({
    id: 'transition_same_id',
    version: 'scenario_event.v1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_event_time_immutable',
    thesis_id: 'thesis_event_time_immutable',
    event_type: 'scenario.triggered',
    event_time: '2026-07-01T00:00:00.000Z',
    summary: 'first',
    payload: { current_price: 100 },
  }, 'workspace_a');

  await journal.saveScenarioEvent({
    id: 'transition_same_id',
    version: 'scenario_event.v1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_event_time_immutable',
    thesis_id: 'thesis_event_time_immutable',
    event_type: 'scenario.triggered',
    event_time: '2026-07-01T01:00:00.000Z',
    summary: 'second',
    payload: { current_price: 101 },
  }, 'workspace_a');

  const events = await journal.listScenarioEvents('scenario_event_time_immutable', 'workspace_a', 10);
  assert.equal(events[0]?.event_time, '2026-07-01T00:00:00.000Z');
  assert.equal(record(events[0]?.payload).current_price, 100);
});
```

- [ ] **Step 2: Change event persistence to immutable writes**

Modify the scenario event upsert SQL to:

```sql
INSERT INTO scenario_events
 (id, workspace_id, scenario_id, thesis_id, event_type, event_time, summary, payload_json)
VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb)
ON CONFLICT (id) DO NOTHING
RETURNING payload_json || jsonb_build_object(
  'version', 'scenario_event.v1',
  'id', id,
  'workspace_id', workspace_id,
  'scenario_id', scenario_id,
  'thesis_id', thesis_id,
  'event_type', event_type,
  'event_time', event_time,
  'summary', summary,
  'payload', payload_json,
  'created_at', created_at
) AS payload_json
```

When `RETURNING` is empty, fetch the existing row by id and workspace.

- [ ] **Step 3: Create transition builder**

Create `apps/api/src/scenarios/scenario-live-transitions.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ScenarioEventResponse, ScenarioLiveStateResponse } from './scenario-chart.types';

export type ScenarioTransitionInput = {
  previous: ScenarioLiveStateResponse | null;
  current: ScenarioLiveStateResponse;
  thesisId: string | null;
  marketSnapshotId: string | null;
};

export function scenarioTransitionEvents(input: ScenarioTransitionInput): ScenarioEventResponse[] {
  const events: ScenarioEventResponse[] = [];
  appendScenarioStatusTransition(events, input, 'trigger_status', 'scenario.triggered', 'triggered');
  appendScenarioStatusTransition(events, input, 'validity_status', 'scenario.invalidated', 'invalidated');
  for (const currentCondition of input.current.condition_evaluations) {
    const previousCondition = input.previous?.condition_evaluations.find(
      (item) => item.id === currentCondition.id,
    );
    if (previousCondition?.status === currentCondition.status) {
      continue;
    }
    if (currentCondition.status === 'passed') {
      events.push(transitionEvent(input, {
        eventType: 'scenario.condition_passed',
        entityType: 'condition',
        entityId: currentCondition.id,
        fromStatus: previousCondition?.status ?? null,
        toStatus: 'passed',
        summary: `Condition passed: ${currentCondition.label}.`,
      }));
    }
    if (currentCondition.status === 'failed') {
      events.push(transitionEvent(input, {
        eventType: 'scenario.condition_failed',
        entityType: 'condition',
        entityId: currentCondition.id,
        fromStatus: previousCondition?.status ?? null,
        toStatus: 'failed',
        summary: `Condition failed: ${currentCondition.label}.`,
      }));
    }
  }
  return events;
}

function appendScenarioStatusTransition(
  events: ScenarioEventResponse[],
  input: ScenarioTransitionInput,
  key: 'trigger_status' | 'validity_status',
  eventType: ScenarioEventResponse['event_type'],
  toStatus: string,
): void {
  if (input.current[key] !== toStatus || input.previous?.[key] === input.current[key]) {
    return;
  }
  events.push(transitionEvent(input, {
    eventType,
    entityType: 'scenario',
    entityId: input.current.scenario_id,
    fromStatus: input.previous?.[key] ?? null,
    toStatus,
    summary: `Scenario ${toStatus}.`,
  }));
}

function transitionEvent(
  input: ScenarioTransitionInput,
  transition: {
    eventType: ScenarioEventResponse['event_type'];
    entityType: 'scenario' | 'condition' | 'target';
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
    summary: string;
  },
): ScenarioEventResponse {
  return {
    version: 'scenario_event.v1',
    id: transitionEventId(input, transition),
    workspace_id: input.current.workspace_id,
    scenario_id: input.current.scenario_id,
    thesis_id: input.thesisId,
    event_type: transition.eventType,
    event_time: input.current.evaluated_at,
    summary: transition.summary,
    payload: {
      entity_id: transition.entityId,
      entity_type: transition.entityType,
      from_status: transition.fromStatus,
      to_status: transition.toStatus,
      market_snapshot_id: input.marketSnapshotId,
      evaluated_at: input.current.evaluated_at,
      current_price: input.current.current_price,
    },
    created_at: input.current.evaluated_at,
  };
}

function transitionEventId(
  input: ScenarioTransitionInput,
  transition: { eventType: string; entityId: string; fromStatus: string | null; toStatus: string },
): string {
  const occurrenceKey = [
    input.current.workspace_id,
    input.current.scenario_id,
    input.marketSnapshotId ?? input.current.evaluated_at,
    transition.eventType,
    transition.entityId,
    transition.fromStatus ?? 'none',
    transition.toStatus,
  ].join(':');
  return `scenario_event_${createHash('sha256').update(occurrenceKey).digest('hex').slice(0, 24)}`;
}
```

- [ ] **Step 4: Store live snapshots separately**

Add to `postgres-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS scenario_live_state_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    market_snapshot_id TEXT,
    evaluated_at TIMESTAMPTZ NOT NULL,
    state_json JSONB NOT NULL,
    source_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_live_state_snapshots_latest
ON scenario_live_state_snapshots(workspace_id, scenario_id, evaluated_at DESC, id DESC);
```

- [ ] **Step 5: Use previous snapshot when refreshing**

In `ScenarioLiveStateService.refreshLiveState()`:

```ts
const previous = await this.journal.getLatestScenarioLiveStateSnapshot?.(scenarioId, workspaceId) ?? null;
const current = await this.getLiveState(scenarioId, workspaceId);
for (const event of scenarioTransitionEvents({
  previous: previous ? toScenarioLiveState(previous.state) : null,
  current,
  thesisId: current.thesis_id ?? null,
  marketSnapshotId: current.market_snapshot_id ?? null,
})) {
  await this.journal.saveScenarioEvent(event as unknown as JsonRecord, workspaceId);
}
await this.journal.saveScenarioLiveStateSnapshot?.(current as unknown as JsonRecord, workspaceId);
return current;
```

- [ ] **Step 6: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "transition events|event_time"
```

Expected:

```text
Transition event tests pass.
Historical event payload and event_time remain immutable.
```

## Task 3: Make Runtime Conditions Candle-Aware

**Files:**

- Create: `apps/api/src/scenarios/scenario-condition-evaluator.ts`
- Modify: `apps/api/src/scenarios/scenario-runtime-evaluator.ts`
- Modify: `apps/api/src/scenarios/scenario-live-state.service.ts`
- Modify: `apps/api/src/scenarios/scenario-chart-projection.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing condition tests**

Add tests:

```ts
test('price reclaim requires a closed candle crossing sequence', () => {
  const result = evaluateScenarioCondition(
    {
      id: 'reclaim_100',
      role: 'trigger',
      type: 'price_reclaim_level',
      level: 100,
      timeframe: '1h',
      candle_close_required: true,
    },
    {
      currentPrice: 101,
      evaluatedAt: '2026-07-02T12:00:00.000Z',
      marketSnapshotId: 'snap_reclaim',
      closedCandlesByInterval: {
        '1h': [
          candle('2026-07-02T10:00:00.000Z', 101, 102, 99, 99),
          candle('2026-07-02T11:00:00.000Z', 99, 102, 98, 101),
        ],
      },
    },
  );
  assert.equal(result.status, 'passed');
});

test('volume confirmation is unknown when lookback candles are insufficient', () => {
  const result = evaluateScenarioCondition(
    {
      id: 'volume_gate',
      role: 'confirmation',
      type: 'volume_above_average',
      timeframe: '1h',
      lookback_periods: 20,
      multiplier: 1.5,
    },
    {
      currentPrice: 101,
      evaluatedAt: '2026-07-02T12:00:00.000Z',
      marketSnapshotId: 'snap_volume',
      closedCandlesByInterval: { '1h': [candle('2026-07-02T11:00:00.000Z', 100, 101, 99, 101, 10)] },
    },
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.blocksStrongAction, true);
});
```

- [ ] **Step 2: Create reusable condition evaluator**

Create `apps/api/src/scenarios/scenario-condition-evaluator.ts`:

```ts
import type { MarketChartInterval, MarketOhlcvCandleResponse } from '../market-data/market-ohlcv.types';
import type { ScenarioDecisionCondition } from './scenario-decision.types';

export type ScenarioConditionStatus = 'passed' | 'failed' | 'pending' | 'unknown';

export type ScenarioConditionEvaluationContext = {
  currentPrice: number | null;
  evaluatedAt: string;
  marketSnapshotId: string | null;
  closedCandlesByInterval: Partial<Record<MarketChartInterval, MarketOhlcvCandleResponse[]>>;
};

export type ScenarioConditionEvaluation = {
  status: ScenarioConditionStatus;
  reason: string;
  blocksStrongAction: boolean;
};

export function evaluateScenarioCondition(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (condition.type === 'price_reclaim_level') {
    return evaluateReclaim(condition, context);
  }
  if (condition.type === 'price_reject_level') {
    return evaluateReject(condition, context);
  }
  if (condition.type === 'volume_above_average') {
    return evaluateVolume(condition, context);
  }
  return evaluateLatestPrice(condition, context.currentPrice);
}

function evaluateReclaim(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (typeof condition.level !== 'number') {
    return unknown('Reclaim level is missing.', condition);
  }
  const candles = candlesFor(condition, context);
  if (candles.length < 2) {
    return unknown('Reclaim requires at least two closed candles.', condition);
  }
  const previous = candles[candles.length - 2]!;
  const current = candles[candles.length - 1]!;
  const passed = previous.close < condition.level && current.close >= condition.level;
  return passed
    ? pass('Closed candle reclaimed the level.')
    : fail('Closed candle has not reclaimed the level.', condition);
}

function evaluateReject(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  if (typeof condition.level !== 'number') {
    return unknown('Reject level is missing.', condition);
  }
  const candles = candlesFor(condition, context);
  if (candles.length < 1) {
    return unknown('Reject requires a closed candle.', condition);
  }
  const current = candles[candles.length - 1]!;
  const passed = current.high >= condition.level && current.close < condition.level;
  return passed
    ? pass('Closed candle rejected the level.')
    : fail('Closed candle has not rejected the level.', condition);
}

function evaluateVolume(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): ScenarioConditionEvaluation {
  const lookback = Math.max(2, Math.floor(condition.lookback_periods ?? 20));
  const multiplier = condition.multiplier ?? 1.5;
  const candles = candlesFor(condition, context).filter((candle) => typeof candle.volume === 'number');
  if (candles.length < lookback + 1) {
    return unknown('Volume confirmation requires enough closed candles.', condition);
  }
  const current = candles[candles.length - 1]!;
  const history = candles.slice(candles.length - lookback - 1, candles.length - 1);
  const average = history.reduce((sum, candle) => sum + (candle.volume ?? 0), 0) / history.length;
  return (current.volume ?? 0) >= average * multiplier
    ? pass('Volume is above lookback average.')
    : fail('Volume is not above lookback average.', condition);
}

function evaluateLatestPrice(
  condition: ScenarioDecisionCondition,
  currentPrice: number | null,
): ScenarioConditionEvaluation {
  if (currentPrice === null) {
    return unknown('Current price is missing.', condition);
  }
  if (condition.type === 'price_above' && typeof condition.level === 'number') {
    return currentPrice >= condition.level ? pass('Price is above level.') : fail('Price is below level.', condition);
  }
  if (condition.type === 'price_below' && typeof condition.level === 'number') {
    return currentPrice <= condition.level ? pass('Price is below level.') : fail('Price is above level.', condition);
  }
  if (
    condition.type === 'price_in_zone' &&
    typeof condition.zone_low === 'number' &&
    typeof condition.zone_high === 'number'
  ) {
    return currentPrice >= Math.min(condition.zone_low, condition.zone_high) &&
      currentPrice <= Math.max(condition.zone_low, condition.zone_high)
      ? pass('Price is inside zone.')
      : fail('Price is outside zone.', condition);
  }
  return unknown('Condition cannot be evaluated from latest price.', condition);
}

function candlesFor(
  condition: ScenarioDecisionCondition,
  context: ScenarioConditionEvaluationContext,
): MarketOhlcvCandleResponse[] {
  const interval = (condition.timeframe as MarketChartInterval | undefined) ?? '1d';
  return context.closedCandlesByInterval[interval] ?? [];
}

function pass(reason: string): ScenarioConditionEvaluation {
  return { status: 'passed', reason, blocksStrongAction: false };
}

function fail(reason: string, condition: ScenarioDecisionCondition): ScenarioConditionEvaluation {
  return { status: 'failed', reason, blocksStrongAction: condition.role === 'confirmation' };
}

function unknown(reason: string, condition: ScenarioDecisionCondition): ScenarioConditionEvaluation {
  return { status: 'unknown', reason, blocksStrongAction: condition.role === 'confirmation' };
}
```

- [ ] **Step 3: Gate strong actions on confirmation unknown/failed**

In `scenario-runtime-evaluator.ts`, include `role === 'confirmation'` conditions in a separate gate list:

```ts
const triggerConditions = runtimeEntryConditions(playbook.entry_conditions);
const confirmationConditions = playbook.entry_conditions.filter(
  (condition) => condition.role === 'confirmation',
);

for (const condition of confirmationConditions) {
  const result = evaluateScenarioCondition(condition, evaluationContext);
  if (result.blocksStrongAction) {
    blockingReasons.push(`Confirmation not passed: ${condition.label ?? condition.type}.`);
    overrides.push(`confirmation_not_passed:${condition.id ?? condition.type}`);
  }
}
```

- [ ] **Step 4: Pass closed candles to live state**

Update live state and chart services to fetch closed candles for intervals referenced by conditions:

```ts
const intervals = conditionIntervals(decisionPlaybook);
const closedCandlesByInterval = await this.loadClosedCandles({
  workspaceId,
  symbol,
  marketType,
  intervals,
  limit: 120,
});
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "reclaim requires|volume confirmation|confirmation not passed"
```

Expected:

```text
Reclaim/reject/volume tests pass.
Confirmation unknown or failed blocks entry-now actions.
```

## Task 4: Add Context Loader And Chart Summary Endpoint

**Files:**

- Create: `apps/api/src/scenarios/scenario-context-loader.service.ts`
- Create: `apps/api/src/scenarios/scenario-chart-summary.service.ts`
- Modify: `apps/api/src/scenarios/scenario-chart-projection.service.ts`
- Modify: `apps/api/src/scenarios/scenario-live-state.service.ts`
- Modify: `apps/api/src/scenarios/scenarios.controller.ts`
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
- Modify: `apps/api/src/scenarios/scenario-chart.types.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing context-loader tests**

Add tests:

```ts
test('scenario chart projection loads scenario context once', async () => {
  const { journal, chartProjection } = buildHarness();
  const scenarioId = seedChartScenario(journal, 'workspace_a');
  journal.resetReadCounters();

  await chartProjection.getProjection({
    scenarioId,
    workspaceId: 'workspace_a',
    interval: '15m',
    limit: '160',
  });

  assert.equal(journal.readCount('getScenario'), 1);
  assert.equal(journal.readCount('getThesis'), 1);
  assert.equal(journal.readCount('listTradePlaybooksForScenario'), 1);
  assert.equal(journal.readCount('listScenarioEvents'), 1);
});

test('scenario chart summary excludes candles', async () => {
  const { journal, scenarios } = buildHarness();
  const scenarioId = seedChartScenario(journal, 'workspace_a');

  const summary = await scenarios.getChartSummary(scenarioId, 'user_1', 'workspace_a');
  assert.equal(summary.version, 'scenario_chart_summary.v1');
  assert.equal('candles' in summary, false);
});
```

- [ ] **Step 2: Create context loader**

Create `apps/api/src/scenarios/scenario-context-loader.service.ts`:

```ts
@Injectable()
export class ScenarioContextLoaderService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  async load(input: {
    scenarioId: string;
    workspaceId: string;
    eventLimit: number;
  }): Promise<ScenarioContext> {
    const scenario = await this.journal.getScenario(input.scenarioId, input.workspaceId);
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const thesisId = stringValue(scenario.thesis_id);
    const thesis = thesisId ? await this.journal.getThesis(thesisId, input.workspaceId) : null;
    const symbol = stringValue(thesis?.symbol ?? scenario.symbol ?? payload.symbol);
    const marketType = marketTypeValue(thesis?.market_type ?? scenario.market_type);
    const snapshot = symbol
      ? await this.journal.getLatestMarketSnapshot(symbol, input.workspaceId)
      : null;
    const playbooks = await this.journal.listTradePlaybooksForScenario(input.scenarioId, input.workspaceId);
    const events = await this.journal.listScenarioEvents(input.scenarioId, input.workspaceId, input.eventLimit);
    return { scenario, payload, thesis, thesisId, symbol, marketType, snapshot, playbooks, events };
  }
}
```

- [ ] **Step 3: Build summary from context**

Create `apps/api/src/scenarios/scenario-chart-summary.service.ts`:

```ts
@Injectable()
export class ScenarioChartSummaryService {
  constructor(
    private readonly contextLoader: ScenarioContextLoaderService,
    private readonly liveState: ScenarioLiveStateService,
  ) {}

  async getSummary(input: { scenarioId: string; workspaceId: string }): Promise<ScenarioChartSummaryResponse> {
    const context = await this.contextLoader.load({
      scenarioId: input.scenarioId,
      workspaceId: input.workspaceId,
      eventLimit: 5,
    });
    const live = await this.liveState.getLiveStateFromContext(context);
    const latestPlaybook = currentFreshPlaybook(context);
    const overlayCounts = overlayCountsFromSources(context, live, latestPlaybook);
    return {
      version: 'scenario_chart_summary.v1',
      workspace_id: input.workspaceId,
      scenario_id: input.scenarioId,
      mode: latestPlaybook?.status === 'current' ? 'trade' : 'watch',
      symbol: context.symbol,
      market_type: context.marketType,
      generated_at: live.evaluated_at,
      trigger_status: live.trigger_status,
      validity_status: live.validity_status,
      trade_playbook_status: latestPlaybook?.status ?? 'missing',
      blocker_count: live.blockers.length,
      warning_count: warningCountFromLiveState(live, latestPlaybook),
      overlay_counts: overlayCounts,
      latest_event: live.latest_event,
    };
  }
}
```

- [ ] **Step 4: Add summary endpoints**

Add:

```ts
@Get(':id/chart-summary')
chartSummary(
  @Param('id') id: string,
  @Headers('x-user-id') userId?: string,
  @Headers('x-workspace-id') workspaceId?: string,
) {
  return this.scenarios.getChartSummary(id, userId, workspaceId);
}

@Post('chart-summaries')
chartSummaries(
  @Body() dto: { scenario_ids: string[] },
  @Headers('x-user-id') userId?: string,
  @Headers('x-workspace-id') workspaceId?: string,
) {
  return this.scenarios.getChartSummaries(dto.scenario_ids, userId, workspaceId);
}
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "chart projection loads scenario context once|chart summary"
```

Expected:

```text
Projection reuses loaded context.
Chart summary responses do not include OHLCV candles.
```

## Task 5: Fix Chart Overlay Semantics And Event Markers

**Files:**

- Modify: `apps/api/src/scenarios/scenario-chart.types.ts`
- Modify: `apps/api/src/scenarios/scenario-chart-projection.service.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/scenarios/scenario-chart-overlays.ts`
- Modify: `apps/web/src/components/scenarios/ScenarioChart.tsx`
- Test: `apps/api/test/api-contract.test.ts`
- Test: `apps/web/test/scenario-chart-behavior.test.ts`

- [ ] **Step 1: Add failing overlay tests**

Add API tests:

```ts
test('scenario chart projection renders trigger zones', async () => {
  const { journal, scenarios } = buildHarness();
  const scenarioId = seedScenarioWithCondition(journal, {
    workspaceId: 'workspace_a',
    role: 'trigger',
    type: 'price_in_zone',
    zone_low: 100,
    zone_high: 105,
  });

  const projection = await scenarios.getChartProjection(
    { scenarioId, interval: '15m', limit: '100' },
    'user_1',
    'workspace_a',
  );

  assert.ok(projection.overlays.some((overlay) => overlay.type === 'price_zone' && overlay.role === 'trigger'));
});

test('scenario chart projection renders invalidation zones', async () => {
  const { journal, scenarios } = buildHarness();
  const scenarioId = seedScenarioWithCondition(journal, {
    workspaceId: 'workspace_a',
    role: 'invalidation',
    type: 'price_in_zone',
    zone_low: 95,
    zone_high: 97,
  });

  const projection = await scenarios.getChartProjection(
    { scenarioId, interval: '15m', limit: '100' },
    'user_1',
    'workspace_a',
  );

  assert.ok(projection.overlays.some((overlay) => overlay.type === 'price_zone' && overlay.role === 'invalidation'));
});
```

Add web behavior test:

```ts
test('scenario chart renderer creates markers for event overlays', () => {
  const markerCalls: unknown[] = [];
  const priceLineCalls: unknown[] = [];
  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => priceLineCalls.push(input),
      setMarkers: (input: unknown[]) => markerCalls.push(...input),
    },
    [
      {
        id: 'event_1',
        type: 'event_marker',
        role: 'event',
        source: 'runtime',
        time: '2026-07-02T00:00:00.000Z',
        price: 100,
        label: 'Scenario triggered',
        status: 'active',
      },
    ],
  );
  assert.equal(markerCalls.length, 1);
  assert.equal(priceLineCalls.length, 0);
});
```

- [ ] **Step 2: Extend zone roles**

Update `ScenarioChartOverlay`:

```ts
type ScenarioChartZoneRole =
  | 'watch'
  | 'trigger'
  | 'entry'
  | 'invalidation'
  | 'target'
  | 'avoid';
```

Use this in the `price_zone` overlay union.

- [ ] **Step 3: Render all decision zones**

In chart projection, zone conditions should become zone overlays for their explicit role:

```ts
if (condition.type === 'price_in_zone') {
  const zone = zoneValue(condition);
  const role = zoneOverlayRole(condition.role);
  if (zone && role) {
    overlays.push({
      id: overlayId(`decision_${role}`, condition),
      type: 'price_zone',
      role,
      source: 'decision_playbook',
      price_low: zone.low,
      price_high: zone.high,
      label: condition.label ?? titleForRole(role),
      status: overlayStatus(condition, evaluations),
    });
  }
}
```

- [ ] **Step 4: Render lightweight chart markers**

Update overlay renderer type:

```ts
type CandleSeries = Pick<
  ISeriesApi<'Candlestick', Time>,
  'createPriceLine' | 'setMarkers'
>;
```

Render event overlays:

```ts
const markers = overlays
  .filter((overlay): overlay is Extract<ScenarioChartOverlay, { type: 'event_marker' }> => overlay.type === 'event_marker')
  .map((overlay) => ({
    time: Math.floor(new Date(overlay.time).getTime() / 1000) as Time,
    position: 'aboveBar' as const,
    color: overlayColor(overlay),
    shape: 'circle' as const,
    text: overlay.label,
  }));

if (markers.length > 0) {
  candleSeries.setMarkers(markers);
}
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "trigger zones|invalidation zones"
node --test --experimental-strip-types --experimental-default-type=module apps/web/test/scenario-chart-behavior.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Trigger and invalidation zones appear in projection.
Event markers render through the chart library marker API.
```

## Task 6: Make Monitor Polling Scalable

**Files:**

- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Modify: `apps/web/src/services/scenario-chart.ts`
- Modify: `apps/web/src/services/query-keys.ts`
- Modify: `apps/web/src/components/scenarios/ScenarioChart.tsx`
- Test: `apps/web/test/scenario-chart-behavior.test.ts`

- [ ] **Step 1: Add failing frontend source tests**

Add:

```ts
test('scenario monitor does not poll full chart for every card in background', () => {
  const source = readFileSync(new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('getScenarioChartProjection('), false);
  assert.equal(source.includes('refetchIntervalInBackground: true'), false);
  assert.equal(source.includes('getScenarioChartSummaries'), true);
});

test('thesis detail full chart query is enabled only for expanded visible scenario', () => {
  const source = readFileSync(new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('enabled: Boolean(scenarioId && isExpandedScenario)'), true);
  assert.equal(source.includes('refetchIntervalInBackground: true'), false);
});
```

- [ ] **Step 2: Add summary service function**

Add:

```ts
export function getScenarioChartSummaries(
  scenarioIds: string[],
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioChartSummaryResponse[]>(
    '/scenarios/chart-summaries',
    {
      method: 'POST',
      body: { scenario_ids: scenarioIds },
    },
    auth,
  );
}
```

- [ ] **Step 3: Replace per-card full chart query**

In `ScenarioMonitorPage.tsx`, fetch summaries once:

```tsx
const scenarioIds = useMemo(
  () => monitorQuery.data?.items.map((item) => item.scenario.id).filter(Boolean) ?? [],
  [monitorQuery.data],
);

const chartSummariesQuery = useQuery({
  enabled: scenarioIds.length > 0,
  queryKey: queryKeys.scenarioChartSummaries(scenarioIds),
  queryFn: () => getScenarioChartSummaries(scenarioIds, auth),
  refetchInterval: (query) => {
    const summaries = query.state.data ?? [];
    return summaries.some((summary) =>
      summary.trigger_status === 'near_trigger' || summary.trigger_status === 'triggered'
    )
      ? 30_000
      : 180_000;
  },
});
```

- [ ] **Step 4: Fetch full chart only when visible or expanded**

Use state:

```tsx
const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);
```

Enable full chart query only for the expanded scenario:

```tsx
const chartQuery = useQuery({
  enabled: Boolean(scenarioId && expandedScenarioId === scenarioId),
  queryKey: queryKeys.scenarioChart(scenarioId, '15m'),
  queryFn: () => getScenarioChartProjection(scenarioId, { interval: '15m', limit: 160 }, auth),
  refetchInterval: vm.triggerStatus === 'triggered' || vm.triggerStatus === 'near_trigger' ? 30_000 : false,
});
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
node --test --experimental-strip-types --experimental-default-type=module apps/web/test/scenario-chart-behavior.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Monitor no longer fetches full chart for every card.
Full chart polling is gated by visible or expanded state.
```

## Task 7: Align API And Web Contracts

**Files:**

- Modify: `apps/api/src/scenarios/scenario-chart.types.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Test: `apps/api/test/api-contract.test.ts`
- Test: `apps/web/test/scenario-chart-behavior.test.ts`

- [ ] **Step 1: Add drift tests**

Add API test:

```ts
test('scenario chart projection source_versions includes stale reasons in OpenAPI', () => {
  const schema = openApiDocument.components.schemas.ScenarioChartProjectionResponse;
  const sourceVersions = record(record(schema.properties).source_versions);
  const properties = record(sourceVersions.properties);
  assert.ok(properties.stale_reasons);
});
```

Add web test:

```ts
test('web scenario chart type matches API source_versions stale reasons', () => {
  const source = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('stale_reasons: string[];'), true);
});
```

- [ ] **Step 2: Make `stale_reasons` explicit**

Update chart projection contract:

```ts
source_versions: {
  decision_playbook_source: 'llm' | 'derived_v1' | 'missing';
  trade_playbook_id: string | null;
  trade_playbook_status: TradePlaybookStatus | 'missing';
  stale_reasons: TradePlaybookStaleReason[];
};
```

- [ ] **Step 3: Populate source versions from freshness evaluator**

In projection builder:

```ts
source_versions: {
  decision_playbook_source: input.decisionPlaybook?.source ?? 'missing',
  trade_playbook_id: input.latestPlaybook?.id ?? null,
  trade_playbook_status: input.latestPlaybook?.status ?? 'missing',
  stale_reasons: input.latestPlaybook?.stale_reasons ?? [],
},
```

- [ ] **Step 4: Update generated client consistently**

Regenerate or manually update generated API client from OpenAPI using the repo's existing generated-client workflow. If no generator command exists, make a focused manual generated-file update and add this comment near the edited schema test:

```ts
// This test protects the manual generated client until an automated OpenAPI client generator is added.
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "source_versions includes stale reasons"
node --test --experimental-strip-types --experimental-default-type=module apps/web/test/scenario-chart-behavior.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
API schema, web type, and generated client agree on source_versions.
```

## Task 8: Add Compact Scenario Feedback Playbook

**Files:**

- Create: `apps/api/src/scenarios/scenario-feedback-playbook.service.ts`
- Modify: `apps/api/src/scenarios/scenario-reliability.controller.ts`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/database/postgres-schema.sql`
- Modify: `apps/api/src/database/postgres-journal.repository.ts`
- Modify: `apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py`
- Modify: `apps/ai-service/luna_workstation/agents/planners/scenario_planner.py`
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Test: `apps/api/test/api-contract.test.ts`
- Test: `apps/ai-service/tests/test_portfolio_manager.py`
- Test: `apps/ai-service/tests/test_structured_agents.py`

- [ ] **Step 1: Add failing feedback contract tests**

Add API test:

```ts
test('scenario feedback playbook excludes raw continuity prose', async () => {
  const { journal, scenarioFeedback } = buildHarness();
  seedScenarioEvaluation(journal, {
    workspaceId: 'workspace_a',
    symbol: 'BTC/USDT',
    result: 'invalidated',
    rawContinuityText: 'old raw continuity paragraph that must not enter prompt context',
  });

  const feedback = await scenarioFeedback.buildForSymbol({
    workspaceId: 'workspace_a',
    symbol: 'BTC/USDT',
  });

  assert.equal(feedback.version, 'scenario_feedback_playbook.v1');
  assert.equal(JSON.stringify(feedback).includes('old raw continuity paragraph'), false);
  assert.ok(feedback.lessons.length > 0);
});
```

Add Python test:

```py
def test_portfolio_manager_renders_compact_scenario_feedback_playbook_only():
    rendered = _render_latest_continuity_context({
        "schema_version": "latest_continuity_context.v1",
        "raw_notes": "raw continuity paragraph should not be copied",
        "scenario_feedback_playbook": {
            "version": "scenario_feedback_playbook.v1",
            "lessons": [
                {
                    "id": "lesson_1",
                    "scope": "scenario",
                    "horizon": "short_term",
                    "market_type": "spot",
                    "statement": "Wait for close confirmation before entry.",
                    "confidence": "medium",
                    "evidence_count": 3,
                }
            ],
            "gates": [],
            "exclusions": [],
        },
    })
    assert "Wait for close confirmation before entry." in rendered
    assert "raw continuity paragraph should not be copied" not in rendered
```

- [ ] **Step 2: Persist feedback playbook rows**

Add table:

```sql
CREATE TABLE IF NOT EXISTS scenario_feedback_playbooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_feedback_playbooks_latest
ON scenario_feedback_playbooks(workspace_id, symbol, generated_at DESC, id DESC);
```

- [ ] **Step 3: Build compact lessons from evaluated artifacts**

Create service output:

```ts
const feedback: ScenarioFeedbackPlaybookResponse = {
  version: 'scenario_feedback_playbook.v1',
  workspace_id: workspaceId,
  symbol,
  generated_at: nowIso,
  source_evaluation_ids: evaluations.map((item) => item.id),
  source_signal_report_ids: reports.map((item) => item.id),
  lessons: lessonsFromEvaluations(evaluations, reports),
  gates: gatesFromFailures(evaluations),
  exclusions: ['raw_continuity_context', 'raw_scenario_prose', 'raw_signal_rows'],
};
```

- [ ] **Step 4: Inject compact feedback through Portfolio Manager boundary**

In Python, render only the compact `scenario_feedback_playbook` subobject:

```py
def _render_scenario_feedback_playbook(context: object) -> str:
    if not isinstance(context, dict):
        return ""
    playbook = context.get("scenario_feedback_playbook")
    if not isinstance(playbook, dict):
        return ""
    lessons = playbook.get("lessons") or []
    lines = ["Scenario feedback playbook:"]
    for lesson in lessons[:8]:
        if isinstance(lesson, dict):
            lines.append(f"- {lesson.get('statement', '')} ({lesson.get('confidence', 'low')})")
    return "\n".join(line for line in lines if line.strip())
```

- [ ] **Step 5: Keep Scenario Planner raw-continuity free**

Add an assertion in `apps/ai-service/tests/test_structured_agents.py`:

```py
def test_scenario_planner_prompt_uses_feedback_playbook_not_raw_continuity():
    prompt = build_scenario_planner_prompt(
        latest_continuity_context={
            "raw_notes": "raw continuity paragraph",
            "scenario_feedback_playbook": {
                "version": "scenario_feedback_playbook.v1",
                "lessons": [{"statement": "Require volume confirmation.", "confidence": "medium"}],
                "gates": [],
            },
        },
    )
    assert "Require volume confirmation." in prompt
    assert "raw continuity paragraph" not in prompt
```

- [ ] **Step 6: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "scenario feedback playbook"
pnpm --filter @lunaperception/ai-service typecheck
pnpm --filter @lunaperception/ai-service test -- tests/test_portfolio_manager.py tests/test_structured_agents.py
```

Expected:

```text
Feedback playbook excludes raw continuity prose.
Portfolio Manager and Scenario Planner consume compact feedback only.
```

## Task 9: Add Workspace And Sync Guardrails

**Files:**

- Modify: `apps/api/test/api-contract.test.ts`
- Modify: `apps/api/src/jobs/research-job.processor.ts`
- Modify: `apps/api/src/jobs/sqlite-journal-sync.service.ts`
- Modify: `apps/api/src/jobs/job-lifecycle.service.ts`
- Modify: `apps/api/src/research-runs/research-runs.service.ts`
- Modify: `docs/known-issues.md`
- Modify: `docs/project-status.md`

- [ ] **Step 1: Add cross-workspace denial tests**

Add tests:

```ts
test('scenario chart endpoints deny cross-workspace reads', async () => {
  const { scenarios, journal } = buildHarness();
  const scenarioId = seedChartScenario(journal, 'workspace_a');
  await assert.rejects(
    scenarios.getChartProjection({ scenarioId, interval: '15m', limit: '100' }, 'user_1', 'workspace_b'),
    /not found|forbidden/i,
  );
});

test('scenario live refresh denies viewer writes', async () => {
  const { scenarios, journal, workspaces } = buildHarness();
  const scenarioId = seedChartScenario(journal, 'workspace_a');
  workspaces.setRole('user_1', 'workspace_a', 'viewer');
  await assert.rejects(
    scenarios.refreshLiveState(scenarioId, 'user_1', 'workspace_a'),
    /forbidden/i,
  );
});

test('scenario feedback playbook does not aggregate across workspaces', async () => {
  const { journal, scenarioFeedback } = buildHarness();
  seedScenarioEvaluation(journal, { workspaceId: 'workspace_a', symbol: 'BTC/USDT', result: 'hit' });
  seedScenarioEvaluation(journal, { workspaceId: 'workspace_b', symbol: 'BTC/USDT', result: 'invalidated' });
  const feedback = await scenarioFeedback.buildForSymbol({ workspaceId: 'workspace_a', symbol: 'BTC/USDT' });
  assert.equal(feedback.source_evaluation_ids.every((id) => id.includes('workspace_a')), true);
});
```

- [ ] **Step 2: Add sync audit outcome to job lifecycle**

When a Python run completes and SQLite sync runs, store:

```ts
postgres_sync: {
  status: sync ? 'completed' : 'skipped',
  synced_tables: sync?.synced_tables ?? [],
  sqlite_path: sync?.sqlite_path ?? result.journal_path ?? null,
  error: null,
}
```

On sync failure:

```ts
postgres_sync: {
  status: 'failed',
  synced_tables: [],
  sqlite_path: result.journal_path ?? null,
  error: errorMessage(error),
}
```

- [ ] **Step 3: Keep failed sync visible**

If engine succeeds but sync fails, the research job lifecycle should not silently look fully complete. Use:

```ts
await this.lifecycle.markCompleted(request.run_id, {
  result,
  warnings: ['postgres_sync_failed'],
  postgres_sync,
});
```

Do not mark the engine run failed when only Postgres sync fails. The run artifact exists in SQLite, and the operator needs an explicit repair path.

- [ ] **Step 4: Document current hosted boundary**

Update `docs/known-issues.md` with:

```markdown
| P0 hosted | Scenario lifecycle sync | Completed Python runs can still depend on SQLite-to-Postgres sync for product API visibility; sync failures must be audited and repairable before hosted beta. | Scenario chart, feedback, evaluation, and playbook surfaces need consistent persisted artifacts. | Scenario Decision V7.1 |
```

- [ ] **Step 5: Run focused checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "cross-workspace|viewer writes|postgres_sync"
```

Expected:

```text
Cross-workspace guardrails pass.
Sync failures are visible as lifecycle warnings.
```

## Task 10: Replace Source-String Web Tests With Behavior Tests

**Files:**

- Create: `apps/web/test/scenario-chart-behavior.test.ts`
- Modify: `apps/web/test/scenario-chart-layout.test.ts`
- Modify: `apps/web/src/components/scenarios/ScenarioChart.tsx`
- Modify: `apps/web/src/components/scenarios/scenario-chart-overlays.ts`

- [ ] **Step 1: Add behavior tests for chart overlay rendering**

Create `apps/web/test/scenario-chart-behavior.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderScenarioOverlays } from '../src/components/scenarios/scenario-chart-overlays.ts';
import type { ScenarioChartOverlay } from '../src/types/index.ts';

test('renderScenarioOverlays renders watch zone boundaries', () => {
  const priceLines: unknown[] = [];
  const markers: unknown[][] = [];
  const overlays: ScenarioChartOverlay[] = [
    {
      id: 'watch_zone',
      type: 'price_zone',
      role: 'watch',
      source: 'decision_playbook',
      price_low: 100,
      price_high: 105,
      label: 'Watch zone',
      status: 'active',
    },
  ];

  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => priceLines.push(input),
      setMarkers: (input: unknown[]) => markers.push(input),
    },
    overlays,
  );

  assert.equal(priceLines.length, 2);
  assert.equal(markers.length, 0);
});

test('renderScenarioOverlays does not render stale trade overlays when caller excludes them', () => {
  const priceLines: unknown[] = [];
  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => priceLines.push(input),
      setMarkers: () => undefined,
    },
    [],
  );
  assert.equal(priceLines.length, 0);
});
```

- [ ] **Step 2: Reduce source-string layout tests**

Keep source-string tests only for prohibited execution copy:

```ts
test('scenario chart source has no execution action copy', () => {
  const source = readFileSync(new URL('../src/components/scenarios/ScenarioChart.tsx', import.meta.url), 'utf8');
  const forbidden = /\b(Buy|Sell|Place order|Submit order|Auto trade|Arm order)\b/;
  assert.equal(forbidden.test(source), false);
});
```

- [ ] **Step 3: Run focused checks**

Run:

```powershell
node --test --experimental-strip-types --experimental-default-type=module apps/web/test/scenario-chart-behavior.test.ts apps/web/test/scenario-chart-layout.test.ts
pnpm --dir apps/web typecheck
```

Expected:

```text
Behavior tests assert renderer calls.
Layout tests keep only copy and source-boundary assertions.
```

## Task 11: Final Verification And Docs Status

**Files:**

- Modify: `docs/features/scenario-decision-system/README.md`
- Modify: `docs/features/README.md`
- Modify: `docs/known-issues.md`
- Modify: `docs/project-status.md`

- [ ] **Step 1: Update roadmap status**

In `docs/features/scenario-decision-system/README.md`, mark:

```text
V7 Visual Scenario Monitoring: implemented or in-progress according to current branch evidence.
V7.1 Scenario Lifecycle Hardening: goal-ready.
V8 Order Draft: blocked until V7.1 definition of done passes.
```

- [ ] **Step 2: Update project status**

Add a current status note:

```markdown
## Current Scenario Decision Focus

V7.1 is the next recommended hardening slice before any order-draft or paper-trading surface. It stabilizes scenario live semantics, transition events, chart scalability, contract drift, compact feedback, workspace guardrails, and SQLite-to-Postgres sync visibility.
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api build
node --test dist/apps/api/test/api-contract.test.js --test-name-pattern "playbook|transition|chart summary|feedback|cross-workspace"
node --test --experimental-strip-types --experimental-default-type=module apps/web/test/scenario-chart-behavior.test.ts apps/web/test/scenario-chart-layout.test.ts
pnpm --dir apps/web typecheck
pnpm --filter @lunaperception/ai-service typecheck
pnpm --filter @lunaperception/ai-service test -- tests/test_portfolio_manager.py tests/test_structured_agents.py
git diff --check
```

Expected:

```text
API focused tests pass.
Web chart behavior tests pass.
AI-service feedback boundary tests pass.
Diff hygiene passes or reports only environmental CRLF warnings already known in this checkout.
```

## Non-Goals

V7.1 must not implement:

- Order draft persistence.
- Paper order persistence.
- Broker execution.
- Portfolio risk governor.
- Strategy optimization.
- Broker-accurate PnL claims.
- Raw continuity injection into Scenario Planner.
- Full migration from SQLite journal to Postgres direct writes.
- A new top-level dashboard unless needed for the hardening checks.

## Definition Of Done

V7.1 is done when:

- Structurally unchanged trade playbooks remain current across volatile runtime refreshes.
- Legacy playbooks without hashes are blocked as `unverifiable`.
- Scenario events preserve transition occurrences without mutating history.
- Reclaim, reject, candle-close, and volume conditions do not overclaim from current price alone.
- Confirmation conditions gate strong runtime actions.
- Full chart projection reuses context and monitor cards use summaries by default.
- Trigger zones, invalidation zones, and event markers render correctly.
- API, OpenAPI, generated client, and web types agree on chart source versions.
- Compact scenario feedback playbook exists and excludes raw continuity prose.
- Cross-workspace tests cover live/chart/event/playbook/feedback reads and writes.
- Sync failures between SQLite and Postgres are visible as lifecycle warnings.
- Docs status reflects that V8 is blocked until V7.1 passes.

## Exit Criteria To V8

Do not start V8 until:

- V7.1 Definition Of Done is met.
- Focused API, web, and AI-service tests pass.
- At least one real scenario can refresh live state twice without false playbook staleness.
- Transition event history can explain a trigger or invalidation without overwritten timestamps.
- A full chart can be opened from a monitor summary without background-polling every scenario card.
- A future order draft can point to a stable scenario/playbook/chart snapshot.

V8 should then introduce:

```text
order_draft.v1
order_analysis_snapshot.v1
user_override_audit.v1
```

V8 must freeze an immutable analysis snapshot at draft creation time. It must not read a mutable live chart projection as the historical rationale for an older draft.
