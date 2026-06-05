# Scenario Watchable Object V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scenarios a monitorable object with clean structured data, lifecycle status, trigger evaluation, and consistent UX across Workbench, Scenario queue, Thesis detail, and Continuity drill-down.

**Architecture:** Normalize scenario data at the API contract boundary first, then add a small evaluator that derives scenario status from latest market snapshots. UI should consume structured fields and shared helpers instead of parsing long AI paragraphs in page components. Continuity remains the lineage/diff layer and should not become the market-trigger evaluator.

**Tech Stack:** NestJS/TypeScript API, React/Vite frontend, existing journal repository, existing Node test runner, existing Python AI-service scenario generation.

---

## Product Decisions

- Workbench is the primary operating screen.
- Scenario queue is a monitor screen.
- Thesis detail is an explain screen.
- Continuity is a drill-down/audit layer for thesis and scenario lineage.
- Scenario V1 supports market-data trigger types only:
  - `price_above`
  - `price_below`
  - `price_reclaim_level`
  - `price_reject_level`
  - `volume_confirmation`
- `near_trigger` threshold defaults to 2%.
- Evaluation is hybrid:
  - active evaluation when `/scenarios` loads
  - scheduler can be added after V1 without changing the contract

## File Map

**API contract**
- Modify: `apps/api/src/contracts/frontend-contract.ts`
  - Extend `ScenarioResponse`.
  - Add scenario normalizers and legacy provenance extraction.

**API scenario evaluation**
- Create: `apps/api/src/scenarios/scenario-evaluator.ts`
  - Parse trigger spec from structured scenario fields.
  - Evaluate status from latest market snapshot.
  - Compute distance to trigger and status reason.
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
  - Use evaluator in monitor response.
  - Sort queue by urgency.

**API tests**
- Modify: `apps/api/test/api-contract.test.ts`
  - Assert normalized fields are exposed.
  - Assert legacy `Source, timeframe, and as_of` text is extracted.
  - Assert scenario monitor status/distance with latest price.

**Frontend types**
- Modify: `apps/web/src/types/index.ts`
  - Add scenario fields mirrored from API.
- Modify: `apps/web/src/services/generated/api-client.ts`
  - Update generated-ish contract manually if local project expects committed generated types.

**Frontend shared scenario view model**
- Create: `apps/web/src/pages/scenario-view-model.ts`
  - Shared text cleanup, provenance, source, evidence, watch trigger, urgency helpers.

**Frontend pages**
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
  - Render queue from normalized fields.
  - Remove long trigger paragraph behavior.
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
  - Consume normalized top-level scenario fields before payload fallback.
  - Keep detail view but stop relying on `payload` only.
- Modify: `apps/web/src/pages/WorkbenchPage.tsx`
  - Add compact Active scenarios module after API contract is stable.

**Frontend tests**
- Modify: `apps/web/test/thesis-detail-layout.test.ts`
  - Assert shared scenario view model is used and top-level provenance is consumed.
- Create: `apps/web/test/scenario-monitor-layout.test.ts`
  - Assert queue uses normalized status/distance and does not render raw parser headings.

**AI service scenario generation**
- Modify: `apps/ai-service/luna_workstation/graph/journal_bridge.py`
  - Keep mapping structured `as_of/timeframe/source`.
  - Add fallback extraction when free-text parser receives `Source, timeframe, and as_of`.
- Modify: `apps/ai-service/tests/test_journal_bridge_scenarios.py`
  - Assert free-text scenario parsing extracts provenance and does not attach source metadata to action.

---

## Task 1: Extend ScenarioResponse With First-Class Fields

**Files:**
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write the failing API contract test**

Append this test near the existing scenario monitor tests in `apps/api/test/api-contract.test.ts`:

```ts
test('scenario response exposes normalized decision and provenance fields', async () => {
  const { journal, theses } = buildHarness();
  journal.scenarios.set(key('thesis_scenario_fields', 'workspace_a'), [
    {
      id: 'scenario_fields',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_scenario_fields',
      scenario_name: 'Breakout confirmation',
      direction: 'bullish',
      thesis_impact: 'strengthens thesis',
      condition: 'Daily close above 620 confirms continuation.',
      expected_market_behavior: 'Continuation toward the next target zone.',
      probability_band: 'medium',
      invalidation: 'Invalid if price closes below 580.',
      evidence: ['Price reclaimed 600 with rising volume.'],
      watch_triggers: ['Daily close above 620'],
      impact_on_thesis: 'Raises conviction if confirmed.',
      risk_map: ['False breakout risk'],
      suggested_user_action: 'Watch for close confirmation.',
      as_of: '2026-06-05',
      timeframe: '1D',
      source: ['market_report', 'quant_signal_text'],
      payload: {
        condition: 'legacy condition should not win',
        source: ['legacy_source'],
      },
    },
  ]);

  const scenarios = await theses.scenarios(
    'thesis_scenario_fields',
    'user_1',
    'workspace_a',
  );

  assert.equal(scenarios[0]?.scenario_name, 'Breakout confirmation');
  assert.equal(scenarios[0]?.direction, 'bullish');
  assert.equal(scenarios[0]?.thesis_impact, 'strengthens thesis');
  assert.equal(scenarios[0]?.condition, 'Daily close above 620 confirms continuation.');
  assert.deepEqual(scenarios[0]?.evidence, ['Price reclaimed 600 with rising volume.']);
  assert.deepEqual(scenarios[0]?.watch_triggers, ['Daily close above 620']);
  assert.equal(scenarios[0]?.impact_on_thesis, 'Raises conviction if confirmed.');
  assert.deepEqual(scenarios[0]?.risk_map, ['False breakout risk']);
  assert.equal(scenarios[0]?.as_of, '2026-06-05');
  assert.equal(scenarios[0]?.timeframe, '1D');
  assert.deepEqual(scenarios[0]?.source, ['market_report', 'quant_signal_text']);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario response exposes normalized"
```

Expected: FAIL because `ScenarioResponse` does not expose those fields.

- [ ] **Step 3: Extend the TypeScript interface**

In `apps/api/src/contracts/frontend-contract.ts`, change `ScenarioResponse` to:

```ts
export interface ScenarioResponse {
  id: string | null;
  workspace_id: string;
  thesis_id: string;
  scenario_name: string;
  direction: string;
  thesis_impact: string;
  probability_band: string;
  suggested_user_action: string;
  condition: string;
  expected_behavior: string;
  invalidation: string;
  evidence: string[];
  watch_triggers: string[];
  impact_on_thesis: string;
  risk_map: string[];
  as_of: string;
  timeframe: string;
  source: string[];
  payload: JsonRecord;
}
```

- [ ] **Step 4: Add normalizers and update `toScenarioResponse`**

Replace `toScenarioResponse` with this structure:

```ts
export function toScenarioResponse(scenario: JsonRecord): ScenarioResponse {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const legacyMeta = legacyScenarioMeta(payload, scenario);
  return {
    id: nullableString(scenario.id),
    workspace_id: stringValue(scenario.workspace_id, 'local'),
    thesis_id: stringValue(scenario.thesis_id),
    scenario_name: firstScenarioString(scenario.scenario_name, payload.scenario_name, payload.scenarioName),
    direction: firstScenarioString(scenario.direction, payload.direction, payload.scenario_direction),
    thesis_impact: firstScenarioString(scenario.thesis_impact, payload.thesis_impact),
    probability_band: firstScenarioString(scenario.probability_band, payload.probability_band),
    suggested_user_action: cleanScenarioAction(
      firstScenarioString(scenario.suggested_user_action, payload.suggested_user_action, payload.suggested_action),
    ),
    condition: cleanScenarioBlock(
      firstScenarioString(scenario.condition, payload.condition),
    ),
    expected_behavior: cleanScenarioBlock(
      firstScenarioString(
        scenario.expected_behavior,
        scenario.expected_market_behavior,
        payload.expected_behavior,
        payload.expected_market_behavior,
      ),
    ),
    invalidation: firstScenarioString(scenario.invalidation, payload.invalidation),
    evidence: firstScenarioStringList(scenario.evidence, payload.evidence, payload.evidence_items),
    watch_triggers: firstScenarioStringList(
      scenario.watch_triggers,
      payload.watch_triggers,
      payload.watchTriggers,
      payload.watch,
    ),
    impact_on_thesis: firstScenarioString(scenario.impact_on_thesis, payload.impact_on_thesis),
    risk_map: firstScenarioStringList(scenario.risk_map, payload.risk_map, payload.risk_factors),
    as_of: firstScenarioString(scenario.as_of, payload.as_of, payload.asOf, payload.source_timestamp, legacyMeta.as_of),
    timeframe: firstScenarioString(scenario.timeframe, payload.timeframe, payload.time_frame, payload.horizon, legacyMeta.timeframe),
    source: firstScenarioStringList(scenario.source, payload.source, payload.sources, payload.source_artifacts, legacyMeta.source),
    payload,
  };
}
```

Add helper functions near existing `stringValue` helpers:

```ts
function firstScenarioString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text && !isScenarioNotRecorded(text)) {
      return text;
    }
  }
  return '';
}

function firstScenarioStringList(...values: unknown[]): string[] {
  for (const value of values) {
    const items = stringList(value)
      .map((item) => item.trim())
      .filter((item) => item && !isScenarioNotRecorded(item));
    if (items.length > 0) {
      return [...new Set(items)];
    }
  }
  return [];
}

function isScenarioNotRecorded(value: string): boolean {
  return ['not recorded', 'n/a', 'none', 'unknown'].includes(value.trim().toLowerCase());
}

function cleanScenarioBlock(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const scenarioHeader = text.match(/^(?:#{1,6}\s*)?Scenario\s+\d+\s*:\s*(.+)$/i);
  return (scenarioHeader?.[1] ?? text).slice(0, 500);
}

function cleanScenarioAction(value: string): string {
  return value
    .replace(/\bSource,\s*timeframe,\s*and\s*as_of\s*:\s*.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function legacyScenarioMeta(
  payload: JsonRecord,
  scenario: JsonRecord,
): { as_of: string; timeframe: string; source: string[] } {
  const text = [
    scenario.suggested_user_action,
    payload.suggested_user_action,
    payload.suggested_action,
    scenario.condition,
    payload.condition,
  ]
    .map((item) => stringValue(item))
    .filter(Boolean)
    .join(' ');
  const match = text.match(/\bSource,\s*timeframe,\s*and\s*as_of\s*:\s*(.+)$/i);
  if (!match) {
    return { as_of: '', timeframe: '', source: [] };
  }
  const raw = match[1].trim();
  return {
    as_of: raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
    timeframe: raw.match(/\b(1m|5m|15m|1h|4h|daily|weekly|monthly|1D|4H|1W)\b/i)?.[1] ?? '',
    source: raw ? [raw.replace(/[.;]\s*$/, '')] : [],
  };
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario response exposes normalized"
```

Expected: PASS.

---

## Task 2: Add Scenario Evaluator

**Files:**
- Create: `apps/api/src/scenarios/scenario-evaluator.ts`
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing evaluator tests through `ScenariosService`**

Add this test near `scenario monitor combines scenarios with price and alert context`:

```ts
test('scenario monitor evaluates trigger distance and lifecycle status', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_eval', 'workspace_a'), {
    id: 'thesis_eval',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    direction: 'long',
    confidence: 0.61,
    created_at: '2026-06-05T00:00:00.000Z',
    thesis_text: 'Watch BNB breakout.',
  });
  journal.scenarios.set(key('thesis_eval', 'workspace_a'), [
    {
      id: 'scenario_eval',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_eval',
      scenario_name: 'Breakout reclaim',
      probability_band: 'medium',
      suggested_user_action: 'watch',
      condition: 'BNB/USDT reclaims 620 on a daily close.',
      payload: {
        trigger_spec: {
          type: 'price_above',
          level: 620,
          timeframe: '1D',
        },
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_bnb_eval', 'workspace_a'), {
    id: 'snap_bnb_eval',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    captured_at: '2026-06-05T00:00:00.000Z',
    current_price: 612,
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.distance_to_trigger, 0.0129);
  assert.match(monitor.items[0]?.scenario.status_reason ?? '', /1.29% below 620/);
  assert.equal(monitor.items[0]?.scenario.trigger_spec.type, 'price_above');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "evaluates trigger distance"
```

Expected: FAIL because evaluator fields do not exist.

- [ ] **Step 3: Create evaluator module**

Create `apps/api/src/scenarios/scenario-evaluator.ts`:

```ts
import type { JsonRecord } from '../database/journal.types';

export type ScenarioStatus =
  | 'watching'
  | 'near_trigger'
  | 'triggered'
  | 'invalidated'
  | 'stale'
  | 'needs_review'
  | 'alerting'
  | 'action_required'
  | 'high_attention'
  | 'missing_price';

export type ScenarioTriggerType =
  | 'price_above'
  | 'price_below'
  | 'price_reclaim_level'
  | 'price_reject_level'
  | 'volume_confirmation';

export interface ScenarioTriggerSpec {
  type: ScenarioTriggerType;
  level?: number;
  zone_low?: number;
  zone_high?: number;
  timeframe?: string;
  confirmation?: {
    candle_close_required?: boolean;
    volume_above_average?: boolean;
  };
}

export interface ScenarioEvaluation {
  status: ScenarioStatus;
  status_reason: string;
  distance_to_trigger: number | null;
  last_evaluated_at: string | null;
  trigger_spec: ScenarioTriggerSpec | null;
}

const NEAR_TRIGGER_THRESHOLD = 0.02;

export function evaluateScenario(
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  nowIso: string,
): ScenarioEvaluation {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const triggerSpec = triggerSpecFromValue(payload.trigger_spec) ?? inferPriceTrigger(scenario, payload);
  if (!triggerSpec) {
    return {
      status: 'needs_review',
      status_reason: 'Scenario trigger is not machine-readable yet.',
      distance_to_trigger: null,
      last_evaluated_at: nowIso,
      trigger_spec: null,
    };
  }
  const currentPrice = numberValue(snapshot?.current_price);
  if (currentPrice === null) {
    return {
      status: 'stale',
      status_reason: 'No latest market snapshot is available for this scenario.',
      distance_to_trigger: null,
      last_evaluated_at: nowIso,
      trigger_spec: triggerSpec,
    };
  }
  const target = triggerSpec.level ?? triggerSpec.zone_high ?? triggerSpec.zone_low ?? null;
  if (target === null || target <= 0) {
    return {
      status: 'needs_review',
      status_reason: 'Scenario trigger has no numeric level.',
      distance_to_trigger: null,
      last_evaluated_at: nowIso,
      trigger_spec: triggerSpec,
    };
  }
  const distance = Number((Math.abs(currentPrice - target) / target).toFixed(4));
  const wantsAbove = ['price_above', 'price_reclaim_level'].includes(triggerSpec.type);
  const triggered = wantsAbove ? currentPrice >= target : currentPrice <= target;
  const side = wantsAbove
    ? currentPrice < target
      ? 'below'
      : 'above'
    : currentPrice > target
      ? 'above'
      : 'below';
  if (triggered) {
    return {
      status: 'triggered',
      status_reason: `Latest price ${formatNumber(currentPrice)} is ${side} trigger ${formatNumber(target)}.`,
      distance_to_trigger: 0,
      last_evaluated_at: nowIso,
      trigger_spec: triggerSpec,
    };
  }
  if (distance <= NEAR_TRIGGER_THRESHOLD) {
    return {
      status: 'near_trigger',
      status_reason: `Latest price ${formatNumber(currentPrice)} is ${formatPercent(distance)} ${side} ${formatNumber(target)}.`,
      distance_to_trigger: distance,
      last_evaluated_at: nowIso,
      trigger_spec: triggerSpec,
    };
  }
  return {
    status: 'watching',
    status_reason: `Latest price ${formatNumber(currentPrice)} is ${formatPercent(distance)} ${side} trigger ${formatNumber(target)}.`,
    distance_to_trigger: distance,
    last_evaluated_at: nowIso,
    trigger_spec: triggerSpec,
  };
}

function inferPriceTrigger(scenario: JsonRecord, payload: JsonRecord): ScenarioTriggerSpec | null {
  const text = [
    scenario.condition,
    payload.condition,
    scenario.expected_market_behavior,
    payload.expected_behavior,
  ]
    .map((item) => stringValue(item))
    .join(' ');
  const levelMatch = text.match(/\b(?:above|over|reclaim(?:s)?|vượt|trên)\s+\$?(\d+(?:\.\d+)?)/i);
  if (levelMatch) {
    return { type: 'price_above', level: Number(levelMatch[1]) };
  }
  const belowMatch = text.match(/\b(?:below|under|break(?:s)? below|dưới)\s+\$?(\d+(?:\.\d+)?)/i);
  if (belowMatch) {
    return { type: 'price_below', level: Number(belowMatch[1]) };
  }
  return null;
}

function triggerSpecFromValue(value: unknown): ScenarioTriggerSpec | null {
  const record = recordValue(value);
  const type = stringValue(record.type) as ScenarioTriggerType;
  if (!['price_above', 'price_below', 'price_reclaim_level', 'price_reject_level', 'volume_confirmation'].includes(type)) {
    return null;
  }
  return {
    type,
    level: numberValue(record.level) ?? undefined,
    zone_low: numberValue(record.zone_low) ?? undefined,
    zone_high: numberValue(record.zone_high) ?? undefined,
    timeframe: stringValue(record.timeframe) || undefined,
    confirmation: recordValue(record.confirmation),
  };
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
```

- [ ] **Step 4: Extend `ScenarioResponse` with evaluation fields**

In `apps/api/src/contracts/frontend-contract.ts`, add to `ScenarioResponse`:

```ts
  status: string;
  status_reason: string;
  distance_to_trigger: number | null;
  last_evaluated_at: string | null;
  trigger_spec: JsonRecord | null;
```

In `toScenarioResponse`, default these fields from top-level or payload:

```ts
    status: firstScenarioString(scenario.status, payload.status, 'watching'),
    status_reason: firstScenarioString(scenario.status_reason, payload.status_reason),
    distance_to_trigger: nullableNumber(scenario.distance_to_trigger ?? payload.distance_to_trigger),
    last_evaluated_at: nullableString(scenario.last_evaluated_at ?? payload.last_evaluated_at),
    trigger_spec: nullableRecord(scenario.trigger_spec ?? payload.trigger_spec),
```

Add:

```ts
function nullableRecord(value: unknown): JsonRecord | null {
  const record = recordValue(value);
  return Object.keys(record).length > 0 ? record : null;
}
```

- [ ] **Step 5: Use evaluator in monitor service**

Modify `apps/api/src/scenarios/scenarios.service.ts`:

```ts
import { evaluateScenario } from './scenario-evaluator';
```

Inside `buildScenarioMonitorItem`, before `return`, add:

```ts
  const evaluation = evaluateScenario(scenario, snapshot, new Date().toISOString());
  const evaluatedScenario = {
    ...scenario,
    status: evaluation.status,
    status_reason: evaluation.status_reason,
    distance_to_trigger: evaluation.distance_to_trigger,
    last_evaluated_at: evaluation.last_evaluated_at,
    trigger_spec: evaluation.trigger_spec,
    payload: {
      ...payload,
      status: evaluation.status,
      status_reason: evaluation.status_reason,
      distance_to_trigger: evaluation.distance_to_trigger,
      last_evaluated_at: evaluation.last_evaluated_at,
      trigger_spec: evaluation.trigger_spec,
    },
  };
```

Change the returned scenario line:

```ts
    scenario: toScenarioResponse(evaluatedScenario),
```

Change monitor `status` selection to prefer evaluator unless an unread alert exists:

```ts
  const status = latestAlert && !latestAlert.read_at
    ? 'alerting'
    : evaluation.status;
```

- [ ] **Step 6: Sort queue by urgency**

Before slicing in `monitor`, replace:

```ts
const limited = items.slice(0, options.limit);
```

with:

```ts
const limited = items.sort(compareScenarioUrgency).slice(0, options.limit);
```

Add:

```ts
function compareScenarioUrgency(left: ScenarioMonitorItemResponse, right: ScenarioMonitorItemResponse): number {
  return scenarioUrgency(right) - scenarioUrgency(left);
}

function scenarioUrgency(item: ScenarioMonitorItemResponse): number {
  const status = item.status;
  if (status === 'alerting') return 100;
  if (status === 'triggered') return 90;
  if (status === 'near_trigger') return 80;
  if (status === 'needs_review') return 60;
  if (status === 'stale') return 50;
  return 10;
}
```

- [ ] **Step 7: Run tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario monitor"
```

Expected: PASS for existing and new scenario monitor tests.

---

## Task 3: Clean Free-Text Scenario Parser in AI Service

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/journal_bridge.py`
- Test: `apps/ai-service/tests/test_journal_bridge_scenarios.py`

- [ ] **Step 1: Write failing parser test**

Append to `apps/ai-service/tests/test_journal_bridge_scenarios.py`:

```py
def test_parse_scenario_plan_extracts_source_timeframe_as_of_from_legacy_action():
    from luna_workstation.graph.journal_bridge import _parse_scenario_plan

    text = """
### Scenario 1: Breakout reclaim

**Condition**: BNB/USDT reclaims 620 on a daily close.
**Expected Behavior**: Continuation toward 650.
**Probability**: Medium
**Evidence**: RSI recovered from oversold.
**Watch Triggers**: Daily close above 620.
**Suggested Action**: Watch for confirmation. Source, timeframe, and as_of: Quant market report dated 2026-06-05, Weekly.
"""

    scenarios = _parse_scenario_plan(text, "thesis_1")

    assert len(scenarios) == 1
    assert scenarios[0].suggested_user_action == "Watch for confirmation."
    assert scenarios[0].as_of == "2026-06-05"
    assert scenarios[0].timeframe == "Weekly"
    assert scenarios[0].source == ["Quant market report dated 2026-06-05, Weekly"]
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
cd apps\ai-service
.\.venv\Scripts\python.exe -m pytest tests/test_journal_bridge_scenarios.py -k legacy_action -v
```

Expected: FAIL because action still contains provenance.

- [ ] **Step 3: Add legacy provenance extractor**

In `apps/ai-service/luna_workstation/graph/journal_bridge.py`, add near scenario parsing helpers:

```py
def _extract_legacy_source_timeframe_as_of(text: str) -> tuple[str, str, list[str], str]:
    raw = str(text or "").strip()
    match = _re.search(
        r"\bSource,\s*timeframe,\s*and\s*as_of\s*:\s*(.+)$",
        raw,
        _re.IGNORECASE,
    )
    if not match:
        return raw, "", [], ""
    source_text = match.group(1).strip().rstrip(".")
    cleaned = raw[: match.start()].strip().rstrip(" .")
    date_match = _re.search(r"\b(\d{4}-\d{2}-\d{2})\b", source_text)
    timeframe_match = _re.search(
        r"\b(1m|5m|15m|1h|4h|daily|weekly|monthly|1D|4H|1W)\b",
        source_text,
        _re.IGNORECASE,
    )
    timeframe = timeframe_match.group(1) if timeframe_match else ""
    return cleaned, date_match.group(1) if date_match else "", [source_text], timeframe
```

- [ ] **Step 4: Apply extractor in `_parse_scenario_plan`**

After `action = _extract_markdown_section(...)`, add:

```py
        clean_action, legacy_as_of, legacy_source, legacy_timeframe = (
            _extract_legacy_source_timeframe_as_of(action)
        )
```

Change `Scenario(...)` fields:

```py
            suggested_user_action=clean_action or "review",
            as_of=as_of or legacy_as_of or "",
            timeframe=timeframe or legacy_timeframe or "",
            source=(_split_list_section(source_raw) or legacy_source)[:8],
```

- [ ] **Step 5: Run focused parser tests**

Run:

```powershell
cd apps\ai-service
.\.venv\Scripts\python.exe -m pytest tests/test_journal_bridge_scenarios.py -k "scenario_plan or legacy_action" -v
```

Expected: PASS.

---

## Task 4: Share Frontend Scenario View Model

**Files:**
- Create: `apps/web/src/pages/scenario-view-model.ts`
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/ThesisDetailPage.tsx`
- Test: `apps/web/test/thesis-detail-layout.test.ts`
- Create: `apps/web/test/scenario-monitor-layout.test.ts`

- [ ] **Step 1: Add source-level layout tests**

Create `apps/web/test/scenario-monitor-layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scenario monitor uses normalized scenario view model', () => {
  const source = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("from './scenario-view-model'"), true);
  assert.equal(source.includes('scenarioMonitorViewModel'), true);
  assert.equal(source.includes('item.scenario.condition || item.trigger_summary'), false);
});
```

Modify `apps/web/test/thesis-detail-layout.test.ts` in `scenario radar strips parser heading artifacts from decision cards`:

```ts
  assert.equal(source.includes("from './scenario-view-model'"), true);
  assert.equal(source.includes('scenarioDetailViewModel'), true);
  assert.equal(source.includes('payload.as_of ??'), false);
```

- [ ] **Step 2: Run frontend tests and verify they fail**

Run:

```powershell
pnpm --filter @lunaperception/web test -- thesis-detail-layout.test.ts scenario-monitor-layout.test.ts
```

Expected: FAIL because view model does not exist.

- [ ] **Step 3: Create scenario view model**

Create `apps/web/src/pages/scenario-view-model.ts`:

```ts
import type { ScenarioResponse } from '@/types';

export type ScenarioTone = 'primary' | 'constructive' | 'warning' | 'risk' | 'degraded';

export interface ScenarioViewModel {
  title: string;
  condition: string;
  expected: string;
  evidence: string[];
  watchTriggers: string[];
  actionLabel: string;
  actionDetail: string;
  actionTone: 'constructive' | 'warning' | 'risk' | 'primary';
  impactOnThesis: string;
  riskMap: string[];
  asOf: string;
  timeframe: string;
  source: string;
  status: string;
  statusReason: string;
  distanceLabel: string;
}

export function scenarioMonitorViewModel(scenario: ScenarioResponse): ScenarioViewModel {
  return buildScenarioViewModel(scenario, 'Scenario');
}

export function scenarioDetailViewModel(scenario: ScenarioResponse, index: number): ScenarioViewModel {
  return buildScenarioViewModel(scenario, `Scenario ${index + 1}`);
}

function buildScenarioViewModel(scenario: ScenarioResponse, fallbackTitle: string): ScenarioViewModel {
  const action = splitAction(scenario.suggested_user_action || 'review');
  return {
    title: cleanText(scenario.scenario_name) || cleanText(scenario.condition).slice(0, 90) || fallbackTitle,
    condition: cleanText(scenario.condition) || 'No trigger condition recorded.',
    expected: cleanText(scenario.expected_behavior),
    evidence: cleanList(scenario.evidence),
    watchTriggers: cleanList(scenario.watch_triggers),
    actionLabel: action.label,
    actionDetail: action.detail,
    actionTone: actionTone(action.label),
    impactOnThesis: cleanText(scenario.impact_on_thesis),
    riskMap: cleanList(scenario.risk_map),
    asOf: cleanText(scenario.as_of) || 'not recorded',
    timeframe: cleanText(scenario.timeframe) || 'not recorded',
    source: cleanList(scenario.source).join(', ') || 'not recorded',
    status: cleanText(scenario.status) || 'watching',
    statusReason: cleanText(scenario.status_reason),
    distanceLabel:
      typeof scenario.distance_to_trigger === 'number'
        ? `${(scenario.distance_to_trigger * 100).toFixed(2)}%`
        : 'n/a',
  };
}

function splitAction(value: string): { label: string; detail: string } {
  const cleaned = cleanText(value);
  const match = cleaned.match(
    /^(watch|monitor|review|reassess|avoid|reduce|exit|stand aside|maintain|downgrade|upgrade|record|wait|hold)\b[:,-]?\s*(.*)$/i,
  );
  if (!match) {
    return { label: 'Review', detail: cleaned };
  }
  return {
    label: match[1].replace(/\b\w/g, (letter) => letter.toUpperCase()),
    detail: match[2]?.trim() ?? '',
  };
}

function actionTone(value: string): 'constructive' | 'warning' | 'risk' | 'primary' {
  const normalized = value.toLowerCase();
  if (normalized.includes('exit') || normalized.includes('reduce') || normalized.includes('avoid')) {
    return 'risk';
  }
  if (normalized.includes('watch') || normalized.includes('monitor') || normalized.includes('hold')) {
    return 'constructive';
  }
  if (normalized.includes('reassess') || normalized.includes('wait')) {
    return 'warning';
  }
  return 'primary';
}

function cleanList(values: string[]): string[] {
  return [...new Set((values ?? []).map(cleanText).filter(Boolean))];
}

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\bSource,\s*timeframe,\s*and\s*as_of\s*:\s*.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Use the view model in `ScenarioMonitorPage`**

Import:

```ts
import { scenarioMonitorViewModel } from './scenario-view-model';
```

Inside `ScenarioMonitorCard`, replace ad hoc constants with:

```ts
  const vm = scenarioMonitorViewModel(item.scenario);
  const condition = vm.condition;
  const actionToneValue = vm.actionTone;
  const expected = vm.expected;
  const statusReason = cleanScenarioText(item.status_reason || vm.statusReason);
  const probability = cleanScenarioText(item.scenario.probability_band) || 'n/a';
```

Change action render to use:

```tsx
<span>{vm.actionDetail || 'Review scenario context.'}</span>
```

- [ ] **Step 5: Use the view model in `ThesisDetailPage`**

Import:

```ts
import { scenarioDetailViewModel } from './scenario-view-model';
```

Inside `ScenarioDecisionCard`, add:

```ts
  const vm = scenarioDetailViewModel(scenario, index);
```

Use `vm.asOf`, `vm.timeframe`, and `vm.source` for meta:

```tsx
<ScenarioMeta label="As of" value={vm.asOf} />
<ScenarioMeta label="Timeframe" value={vm.timeframe} />
<ScenarioMeta label="Source" value={vm.source} />
```

- [ ] **Step 6: Run frontend tests**

Run:

```powershell
pnpm --filter @lunaperception/web test -- thesis-detail-layout.test.ts scenario-monitor-layout.test.ts
```

Expected: PASS.

---

## Task 5: Add Workbench Active Scenarios Module

**Files:**
- Modify: `apps/api/src/workbench/workbench.service.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/web/src/pages/WorkbenchPage.tsx`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add API test for active scenario priority**

Add a test near Workbench tests in `apps/api/test/api-contract.test.ts`:

```ts
test('workbench includes active scenarios ordered by monitor urgency', async () => {
  const { journal, workbench } = buildHarness();
  journal.theses.set(key('thesis_workbench_scenario', 'workspace_a'), {
    id: 'thesis_workbench_scenario',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB levels.',
  });
  journal.scenarios.set(key('thesis_workbench_scenario', 'workspace_a'), [
    {
      id: 'scenario_workbench_near',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_workbench_scenario',
      scenario_name: 'Breakout near',
      condition: 'BNB/USDT reclaims 620.',
      suggested_user_action: 'watch',
      payload: { trigger_spec: { type: 'price_above', level: 620 } },
    },
  ]);
  journal.marketSnapshots.set(key('snap_workbench_bnb', 'workspace_a'), {
    id: 'snap_workbench_bnb',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 612,
    captured_at: '2026-06-05T00:00:00.000Z',
    source: 'test',
  });

  const response = await workbench.overview('user_1', 'workspace_a');

  assert.equal(response.active_scenarios[0]?.id, 'scenario_workbench_near');
  assert.equal(response.active_scenarios[0]?.status, 'near_trigger');
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "workbench includes active scenarios"
```

Expected: FAIL because Workbench response does not include `active_scenarios`.

- [ ] **Step 3: Add `active_scenarios` to Workbench response**

In `apps/api/src/contracts/frontend-contract.ts`, add to the Workbench response interface:

```ts
active_scenarios: ScenarioResponse[];
```

In `apps/api/src/workbench/workbench.service.ts`, reuse scenario list and `evaluateScenario` to build a top 5 list for latest theses. Keep this first version scoped to existing journal calls; do not add new scheduler behavior in this task.

- [ ] **Step 4: Render compact module in Workbench**

In `apps/web/src/pages/WorkbenchPage.tsx`, add a panel titled `Active scenarios` near current thesis/risk modules. Render max 5 items with:

```tsx
<strong>{scenario.scenario_name || scenario.condition}</strong>
<span className="badge">{scenario.status.replaceAll('_', ' ')}</span>
<p>{scenario.status_reason || scenario.condition}</p>
```

- [ ] **Step 5: Run API and web source tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "workbench includes active scenarios"
pnpm --filter @lunaperception/web test -- top-command-strip.test.ts workspace-switcher.test.ts
```

Expected: API focused test passes. Existing web smoke/source tests pass.

---

## Task 6: Continuity Bridge Alignment

**Files:**
- Modify: `apps/api/src/research-continuity/research-snapshot.builder.ts`
- Modify: `apps/api/src/research-continuity/continuity-state.projector.ts`
- Test: `apps/api/test/api-contract.test.ts`
- Test: `apps/api/test/research-continuity-state.projector.test.ts`

- [ ] **Step 1: Add test that scenario branches carry lifecycle fields**

In `apps/api/test/api-contract.test.ts`, extend the existing `research continuity tracks scenario branches across snapshots and deltas` setup scenario with:

```ts
payload: {
  trigger_spec: { type: 'price_above', level: 620 },
  status: 'watching',
  distance_to_trigger: 0.04,
}
```

Assert the generated snapshot branch includes:

```ts
assert.equal(record(records(baselineSnapshot?.scenario_branches)[0]).status, 'watching');
assert.deepEqual(record(record(records(baselineSnapshot?.scenario_branches)[0]).trigger_spec), {
  type: 'price_above',
  level: 620,
});
```

- [ ] **Step 2: Run focused continuity test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "research continuity tracks scenario branches"
```

Expected: FAIL until snapshot builder copies lifecycle fields.

- [ ] **Step 3: Copy lifecycle fields into snapshot branches**

In `apps/api/src/research-continuity/research-snapshot.builder.ts`, inside `scenarioBranch`, include:

```ts
    status: stringValue(scenario.status ?? payload.status, 'watching'),
    status_reason: stringValue(scenario.status_reason ?? payload.status_reason),
    distance_to_trigger: nullableNumber(scenario.distance_to_trigger ?? payload.distance_to_trigger),
    last_evaluated_at: nullableString(scenario.last_evaluated_at ?? payload.last_evaluated_at),
    trigger_spec: recordValue(scenario.trigger_spec ?? payload.trigger_spec),
```

Use existing helper names in this file. If `nullableNumber` or `nullableString` is missing, add local equivalents matching existing style.

- [ ] **Step 4: Keep Continuity as lineage, not evaluator**

Do not import `evaluateScenario` into continuity files. Continuity should only carry and compare fields that already exist on scenarios.

- [ ] **Step 5: Run continuity tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "research continuity tracks scenario branches"
pnpm --filter @lunaperception/api test -- research-continuity-state.projector.test.ts
```

Expected: PASS.

---

## Task 7: Final Verification

**Files:**
- No planned code changes.

- [ ] **Step 1: Run focused API tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario|workbench includes active scenarios|research continuity tracks scenario"
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```powershell
pnpm --filter @lunaperception/web test -- thesis-detail-layout.test.ts scenario-monitor-layout.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run type checks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual browser verification**

Start dev servers as the project normally does, then verify:

- `/workbench` shows Active scenarios compactly.
- `/scenarios` no longer displays long markdown blocks as trigger text.
- Thesis detail scenario tab shows `As of`, `Timeframe`, and `Source` from structured fields.
- Continuity still renders scenario lifecycle items and does not evaluate triggers itself.

Expected: Both `/scenarios` and thesis detail describe the same scenario consistently, with different density rather than different data.

---

## Self-Review

**Spec coverage:** This plan covers scenario contract cleanup, lifecycle evaluator, Workbench primary UX, Scenario queue cleanup, Thesis detail cleanup, and Continuity as lineage/diff layer.

**Intentional omissions:** Scheduler and websocket updates are not in V1. The active evaluator on `/scenarios` and Workbench is enough to validate the object model before adding background jobs.

**Type consistency:** API response fields use snake_case to match existing DTO style. Frontend view model converts them to display fields without changing backend names.

