# Scenario Decision Runtime V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved scenarios produce a cautious, evidence-gated runtime decision such as `wait`, `consider_long`, `entry_long_now`, `avoid`, or `review` from a structured decision playbook, latest market data, and validity window.

**Architecture:** V1 does not add a new LLM agent. It introduces structured scenario decision types, a deterministic runtime evaluator, API contract fields, and UI rendering. LLM-generated playbooks can be stored in `scenario.payload.decision_playbook`; when a playbook is missing, the evaluator derives only a conservative V1 playbook from existing scenario fields and marks it as `derived_v1`.

**Tech Stack:** NestJS/TypeScript API, existing journal repository, React/Vite frontend, existing Node test runner, existing scenario monitor/workbench surfaces.

---

## Product Contract

Scenario V1 separates three concepts:

- `trigger_status`: market relation to the trigger, such as `watching`, `near_trigger`, `triggered`, `stale`, or `needs_review`.
- `validity_status`: whether the scenario is still usable, such as `valid`, `expired`, `overextended`, `invalidated`, `conflicted`, or `needs_review`.
- `recommended_action`: operational action, such as `wait`, `consider_long`, `entry_long_now`, `entry_short_now`, `avoid`, or `review`.

`entry_long_now` and `entry_short_now` are allowed, but only if all hard gates pass:

- trigger is `triggered`
- validity is `valid`
- market data is fresh
- invalidation exists
- scenario is not expired
- scenario is not overextended
- confidence is at least `0.70`
- no blocking reasons remain

`near_trigger` may produce `consider_long` or `consider_short`, but never `entry_*_now`.

V1 does not persist alerts from page reload. Workbench and Scenario Monitor display computed runtime decisions. Alert persistence and scheduler-based notifications are deferred.

---

## File Map

**API decision types**

- Create: `apps/api/src/scenarios/scenario-decision.types.ts`
  - Owns decision enum types, playbook shape, runtime decision shape, and evidence-ref shape.

**API runtime evaluator**

- Create: `apps/api/src/scenarios/scenario-runtime-evaluator.ts`
  - Reads scenario fields, `payload.decision_playbook`, latest market snapshot, and current time.
  - Produces deterministic `runtime_decision`.
  - Does not call LLM and does not write DB state.

**API contract**

- Modify: `apps/api/src/contracts/frontend-contract.ts`
  - Add `runtime_decision` and `decision_playbook` to `ScenarioResponse`.
  - Include normalized output from `toScenarioResponse`.

**API services**

- Modify: `apps/api/src/scenarios/scenarios.service.ts`
  - Call runtime evaluator in scenario monitor item construction.
  - Keep existing `status` compatibility but prefer runtime fields.
- Modify: `apps/api/src/workbench/workbench.service.ts`
  - Attach runtime decisions to active scenario responses.
  - Sort scenario urgency using runtime action and trigger status.

**API tests**

- Modify: `apps/api/test/api-contract.test.ts`
  - Add contract coverage for expiry, near-trigger, triggered entry gating, overextended blocking, and missing evidence/invalidation downgrade.

**Frontend types**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
  - Mirror `ScenarioResponse` additions.

**Frontend view model and pages**

- Modify: `apps/web/src/pages/scenario-view-model.ts`
  - Convert runtime decisions into display labels, action tones, and blocking reason text.
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
  - Show runtime action/status in queue cards.
- Modify: `apps/web/src/pages/WorkbenchPage.tsx`
  - Show active scenario action and reason compactly.

**Frontend tests**

- Modify: `apps/web/test/scenario-monitor-layout.test.ts`
- Modify: `apps/web/test/thesis-detail-layout.test.ts` only if the shared view model assertions need updating.

---

## Task 1: Add Scenario Decision Types

**Files:**
- Create: `apps/api/src/scenarios/scenario-decision.types.ts`

- [ ] **Step 1: Create the decision type module**

Create `apps/api/src/scenarios/scenario-decision.types.ts` with:

```ts
import type { JsonRecord } from '../database/journal.types';

export type ScenarioTriggerStatus =
  | 'watching'
  | 'near_trigger'
  | 'triggered'
  | 'stale'
  | 'missing_price'
  | 'needs_review';

export type ScenarioValidityStatus =
  | 'valid'
  | 'weakening'
  | 'invalidated'
  | 'expired'
  | 'overextended'
  | 'conflicted'
  | 'needs_review';

export type ScenarioRecommendedAction =
  | 'wait'
  | 'entry_long_now'
  | 'entry_short_now'
  | 'consider_long'
  | 'consider_short'
  | 'avoid'
  | 'reduce'
  | 'exit'
  | 'review';

export type ScenarioActionBias = 'long' | 'short' | 'neutral' | 'unknown';

export interface ScenarioEvidenceRef {
  type: string;
  id: string | null;
  field: string;
  label: string;
  supports: string;
}

export interface ScenarioDecisionCondition {
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

export interface ScenarioDecisionPlaybook {
  version: 'scenario_decision_playbook.v1';
  source: 'llm' | 'derived_v1';
  generated_at: string | null;
  generated_from_run_id: string | null;
  action_bias: ScenarioActionBias;
  confidence: number;
  preferred_action_if_triggered: ScenarioRecommendedAction;
  fallback_action: ScenarioRecommendedAction;
  near_trigger_threshold_pct: number;
  validity_window: {
    valid_from: string | null;
    valid_until: string | null;
    timeframe: string;
    rationale: string;
    refresh_policy: 'refresh_on_next_research_run' | 'manual_review';
  };
  entry_conditions: ScenarioDecisionCondition[];
  avoid_if: ScenarioDecisionCondition[];
  invalidation_conditions: ScenarioDecisionCondition[];
  wait_for: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  rationale: string;
}

export interface ScenarioRuntimeDecision {
  version: 'scenario_runtime_decision.v1';
  evaluated_at: string;
  trigger_status: ScenarioTriggerStatus;
  validity_status: ScenarioValidityStatus;
  recommended_action: ScenarioRecommendedAction;
  confidence: number;
  matched_conditions: string[];
  failed_conditions: string[];
  blocking_reasons: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  source: 'rule_engine_from_decision_playbook';
  playbook_source: 'llm' | 'derived_v1' | 'missing';
  status_reason: string;
  distance_to_trigger: number | null;
  llm_recommendation: JsonRecord | null;
  final_decision: {
    action: ScenarioRecommendedAction;
    reason: string;
    overrides: string[];
  };
}
```

- [ ] **Step 2: Run API typecheck to verify the new standalone module compiles**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
```

Expected: PASS or the same pre-existing typecheck failure unrelated to this new file. If a new error references `scenario-decision.types.ts`, fix the exact type mismatch before moving on.

---

## Task 2: Implement Runtime Evaluator

**Files:**
- Create: `apps/api/src/scenarios/scenario-runtime-evaluator.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing API test for expired scenario runtime decision**

Append this test near the existing scenario monitor tests in `apps/api/test/api-contract.test.ts`:

```ts
test('scenario runtime decision marks expired playbooks as review only', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_expired_runtime', 'workspace_a'), {
    id: 'thesis_expired_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_expired_runtime', 'workspace_a'), [
    {
      id: 'scenario_expired_runtime',
      workspace_id: 'workspace_a',
      thesis_id: 'thesis_expired_runtime',
      scenario_name: 'Expired reclaim',
      condition: 'BNB/USDT reclaims 620.',
      invalidation: 'Invalid below 600.',
      probability_band: 'medium',
      payload: {
        trigger_spec: { type: 'price_above', level: 620 },
        decision_playbook: {
          version: 'scenario_decision_playbook.v1',
          source: 'llm',
          generated_at: '2026-06-01T00:00:00.000Z',
          generated_from_run_id: 'run_old',
          action_bias: 'long',
          confidence: 0.82,
          preferred_action_if_triggered: 'entry_long_now',
          fallback_action: 'wait',
          near_trigger_threshold_pct: 2,
          validity_window: {
            valid_from: '2026-06-01T00:00:00.000Z',
            valid_until: '2026-06-02T00:00:00.000Z',
            timeframe: '1D',
            rationale: 'Old setup window.',
            refresh_policy: 'refresh_on_next_research_run',
          },
          entry_conditions: [{ type: 'price_above', level: 620 }],
          avoid_if: [{ type: 'overextended_from_trigger', threshold_pct: 2.5 }],
          invalidation_conditions: [{ type: 'price_below', level: 600 }],
          wait_for: ['Price above 620.'],
          risk_notes: [],
          evidence_refs: [
            {
              type: 'scenario',
              id: 'scenario_expired_runtime',
              field: 'trigger_spec.level',
              label: 'Trigger 620',
              supports: 'Trigger level is defined.',
            },
          ],
          rationale: 'Use only inside the validity window.',
        },
      },
    },
  ]);
  journal.marketSnapshots.set(key('snap_bnb_expired_runtime', 'workspace_a'), {
    id: 'snap_bnb_expired_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 625,
    captured_at: '2026-06-07T00:00:00.000Z',
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'expired');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'review');
  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes('expired'),
    true,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "expired playbooks"
```

Expected: FAIL because `runtime_decision` is not on `ScenarioResponse`.

- [ ] **Step 3: Create the runtime evaluator**

Create `apps/api/src/scenarios/scenario-runtime-evaluator.ts`:

```ts
import type { JsonRecord } from '../database/journal.types';
import {
  ScenarioDecisionCondition,
  ScenarioDecisionPlaybook,
  ScenarioEvidenceRef,
  ScenarioRecommendedAction,
  ScenarioRuntimeDecision,
  ScenarioTriggerStatus,
  ScenarioValidityStatus,
} from './scenario-decision.types';

const DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT = 2;
const DEFAULT_OVEREXTENDED_THRESHOLD_PCT = 2.5;
const ENTRY_NOW_CONFIDENCE_THRESHOLD = 0.7;
const MARKET_STALE_MINUTES = 90;

export function evaluateScenarioRuntimeDecision(
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  nowIso: string,
): ScenarioRuntimeDecision {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const playbook = normalizedPlaybook(scenario, payload, nowIso);
  const currentPrice = nullableNumber(snapshot?.current_price);
  const triggerLevel = primaryTriggerLevel(playbook);
  const evidenceRefs = playbook.evidence_refs;
  const blockingReasons: string[] = [];
  const matchedConditions: string[] = [];
  const failedConditions: string[] = [];
  const overrides: string[] = [];

  const triggerStatus = triggerStatusFor({
    currentPrice,
    triggerLevel,
    nearThresholdPct: playbook.near_trigger_threshold_pct,
    actionBias: playbook.action_bias,
  });
  const distanceToTrigger =
    currentPrice !== null && triggerLevel !== null
      ? Number((Math.abs(currentPrice - triggerLevel) / triggerLevel).toFixed(4))
      : null;

  const validity = validityStatusFor(playbook, currentPrice, nowIso, snapshot);
  if (validity.status !== 'valid') {
    blockingReasons.push(validity.reason);
    overrides.push(validity.reason);
  }
  if (marketIsStale(snapshot, nowIso)) {
    blockingReasons.push('stale_market_data');
    overrides.push('stale_market_data');
  }
  if (currentPrice === null) {
    blockingReasons.push('missing_market_data');
    overrides.push('missing_market_data');
  }
  if (playbook.invalidation_conditions.length === 0) {
    blockingReasons.push('missing_invalidation');
    overrides.push('missing_invalidation');
  }
  if (evidenceRefs.length === 0) {
    blockingReasons.push('missing_evidence_refs');
    overrides.push('missing_evidence_refs');
  }
  if (isOverextended(playbook, currentPrice, triggerLevel)) {
    blockingReasons.push('overextended');
    overrides.push('overextended');
  }

  for (const condition of playbook.entry_conditions) {
    const result = conditionResult(condition, currentPrice);
    if (result === 'matched') {
      matchedConditions.push(conditionLabel(condition));
    }
    if (result === 'failed') {
      failedConditions.push(conditionLabel(condition));
    }
    if (result === 'unknown') {
      blockingReasons.push(`unknown_condition:${condition.type}`);
    }
  }

  const recommendedAction = finalAction({
    triggerStatus,
    validityStatus: validity.status,
    preferred: playbook.preferred_action_if_triggered,
    fallback: playbook.fallback_action,
    actionBias: playbook.action_bias,
    confidence: playbook.confidence,
    blockingReasons: uniqueStrings(blockingReasons),
  });
  const statusReason = statusReasonFor(
    recommendedAction,
    triggerStatus,
    validity.status,
    triggerLevel,
    currentPrice,
    uniqueStrings(blockingReasons),
  );

  return {
    version: 'scenario_runtime_decision.v1',
    evaluated_at: nowIso,
    trigger_status: triggerStatus,
    validity_status: validity.status,
    recommended_action: recommendedAction,
    confidence: confidenceAfterGates(playbook.confidence, uniqueStrings(blockingReasons)),
    matched_conditions: uniqueStrings(matchedConditions),
    failed_conditions: uniqueStrings(failedConditions),
    blocking_reasons: uniqueStrings(blockingReasons),
    risk_notes: playbook.risk_notes,
    evidence_refs: evidenceRefs,
    source: 'rule_engine_from_decision_playbook',
    playbook_source: playbook.source,
    status_reason: statusReason,
    distance_to_trigger: distanceToTrigger,
    llm_recommendation: null,
    final_decision: {
      action: recommendedAction,
      reason: statusReason,
      overrides: uniqueStrings(overrides),
    },
  };
}

function normalizedPlaybook(
  scenario: JsonRecord,
  payload: JsonRecord,
  nowIso: string,
): ScenarioDecisionPlaybook {
  const raw = recordValue(payload.decision_playbook);
  if (raw.version === 'scenario_decision_playbook.v1') {
    return {
      version: 'scenario_decision_playbook.v1',
      source: stringValue(raw.source) === 'llm' ? 'llm' : 'derived_v1',
      generated_at: nullableString(raw.generated_at),
      generated_from_run_id: nullableString(raw.generated_from_run_id),
      action_bias: actionBiasValue(raw.action_bias),
      confidence: clampConfidence(raw.confidence),
      preferred_action_if_triggered: actionValue(raw.preferred_action_if_triggered, 'review'),
      fallback_action: actionValue(raw.fallback_action, 'wait'),
      near_trigger_threshold_pct: positiveNumber(
        raw.near_trigger_threshold_pct,
        DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT,
      ),
      validity_window: {
        valid_from: nullableString(recordValue(raw.validity_window).valid_from),
        valid_until: nullableString(recordValue(raw.validity_window).valid_until),
        timeframe: stringValue(recordValue(raw.validity_window).timeframe, stringValue(scenario.timeframe, 'unknown')),
        rationale: stringValue(recordValue(raw.validity_window).rationale),
        refresh_policy:
          stringValue(recordValue(raw.validity_window).refresh_policy) === 'manual_review'
            ? 'manual_review'
            : 'refresh_on_next_research_run',
      },
      entry_conditions: conditionList(raw.entry_conditions),
      avoid_if: conditionList(raw.avoid_if),
      invalidation_conditions: conditionList(raw.invalidation_conditions),
      wait_for: stringList(raw.wait_for),
      risk_notes: stringList(raw.risk_notes),
      evidence_refs: evidenceRefList(raw.evidence_refs),
      rationale: stringValue(raw.rationale),
    };
  }

  const triggerSpec = recordValue(payload.trigger_spec ?? scenario.trigger_spec);
  const entryConditions = triggerSpec.type ? [conditionFromTriggerSpec(triggerSpec)] : [];
  const invalidation = stringValue(scenario.invalidation ?? payload.invalidation);
  return {
    version: 'scenario_decision_playbook.v1',
    source: 'derived_v1',
    generated_at: nowIso,
    generated_from_run_id: nullableString(scenario.research_run_id),
    action_bias: inferredActionBias(scenario, payload),
    confidence: 0.55,
    preferred_action_if_triggered:
      inferredActionBias(scenario, payload) === 'short' ? 'consider_short' : 'consider_long',
    fallback_action: 'wait',
    near_trigger_threshold_pct: DEFAULT_NEAR_TRIGGER_THRESHOLD_PCT,
    validity_window: {
      valid_from: nullableString(scenario.as_of ?? payload.as_of),
      valid_until: nullableString(payload.valid_until),
      timeframe: stringValue(scenario.timeframe ?? payload.timeframe, 'unknown'),
      rationale: 'Derived V1 playbook uses existing scenario fields and requires review for stronger actions.',
      refresh_policy: 'refresh_on_next_research_run',
    },
    entry_conditions: entryConditions,
    avoid_if: [{ type: 'overextended_from_trigger', threshold_pct: DEFAULT_OVEREXTENDED_THRESHOLD_PCT }],
    invalidation_conditions: invalidation ? [] : [],
    wait_for: stringList(scenario.watch_triggers ?? payload.watch_triggers),
    risk_notes: stringList(scenario.risk_map ?? payload.risk_map ?? payload.risk_factors),
    evidence_refs: entryConditions.length
      ? [
          {
            type: 'scenario',
            id: nullableString(scenario.id),
            field: 'payload.trigger_spec',
            label: 'Scenario trigger spec',
            supports: 'Trigger spec exists for derived V1 playbook.',
          },
        ]
      : [],
    rationale: 'Derived conservatively without an LLM-authored decision playbook.',
  };
}

function finalAction(input: {
  triggerStatus: ScenarioTriggerStatus;
  validityStatus: ScenarioValidityStatus;
  preferred: ScenarioRecommendedAction;
  fallback: ScenarioRecommendedAction;
  actionBias: string;
  confidence: number;
  blockingReasons: string[];
}): ScenarioRecommendedAction {
  if (input.validityStatus === 'expired' || input.validityStatus === 'invalidated') {
    return 'review';
  }
  if (input.blockingReasons.includes('missing_market_data') || input.blockingReasons.includes('stale_market_data')) {
    return 'review';
  }
  if (input.triggerStatus === 'near_trigger') {
    if (input.validityStatus === 'valid' && input.confidence >= ENTRY_NOW_CONFIDENCE_THRESHOLD) {
      return input.actionBias === 'short' ? 'consider_short' : 'consider_long';
    }
    return input.fallback;
  }
  if (input.triggerStatus !== 'triggered') {
    return input.fallback;
  }
  if (input.blockingReasons.length > 0) {
    return input.actionBias === 'short' ? 'consider_short' : 'consider_long';
  }
  if (
    input.confidence >= ENTRY_NOW_CONFIDENCE_THRESHOLD &&
    (input.preferred === 'entry_long_now' || input.preferred === 'entry_short_now')
  ) {
    return input.preferred;
  }
  return input.actionBias === 'short' ? 'consider_short' : 'consider_long';
}

function triggerStatusFor(input: {
  currentPrice: number | null;
  triggerLevel: number | null;
  nearThresholdPct: number;
  actionBias: string;
}): ScenarioTriggerStatus {
  if (input.currentPrice === null) {
    return 'missing_price';
  }
  if (input.triggerLevel === null || input.triggerLevel <= 0) {
    return 'needs_review';
  }
  const wantsBelow = input.actionBias === 'short';
  const triggered = wantsBelow
    ? input.currentPrice <= input.triggerLevel
    : input.currentPrice >= input.triggerLevel;
  if (triggered) {
    return 'triggered';
  }
  const distancePct = (Math.abs(input.currentPrice - input.triggerLevel) / input.triggerLevel) * 100;
  return distancePct <= input.nearThresholdPct ? 'near_trigger' : 'watching';
}

function validityStatusFor(
  playbook: ScenarioDecisionPlaybook,
  currentPrice: number | null,
  nowIso: string,
  snapshot: JsonRecord | null,
): { status: ScenarioValidityStatus; reason: string } {
  const validUntil = playbook.validity_window.valid_until;
  if (validUntil && Date.parse(validUntil) < Date.parse(nowIso)) {
    return { status: 'expired', reason: 'expired' };
  }
  if (marketIsStale(snapshot, nowIso)) {
    return { status: 'needs_review', reason: 'stale_market_data' };
  }
  const invalidationHit = playbook.invalidation_conditions.some((condition) =>
    conditionResult(condition, currentPrice) === 'matched',
  );
  if (invalidationHit) {
    return { status: 'invalidated', reason: 'invalidation_hit' };
  }
  return { status: 'valid', reason: 'valid' };
}

function isOverextended(
  playbook: ScenarioDecisionPlaybook,
  currentPrice: number | null,
  triggerLevel: number | null,
): boolean {
  if (currentPrice === null || triggerLevel === null || triggerLevel <= 0) {
    return false;
  }
  const threshold =
    playbook.avoid_if
      .filter((condition) => condition.type === 'overextended_from_trigger')
      .map((condition) => positiveNumber(condition.threshold_pct, DEFAULT_OVEREXTENDED_THRESHOLD_PCT))[0] ??
    DEFAULT_OVEREXTENDED_THRESHOLD_PCT;
  const distancePct = (Math.abs(currentPrice - triggerLevel) / triggerLevel) * 100;
  return distancePct > threshold && conditionResult(playbook.entry_conditions[0], currentPrice) === 'matched';
}

function conditionResult(
  condition: ScenarioDecisionCondition | undefined,
  currentPrice: number | null,
): 'matched' | 'failed' | 'unknown' {
  if (!condition || currentPrice === null) {
    return 'unknown';
  }
  if (condition.type === 'price_above' || condition.type === 'price_reclaim_level') {
    return typeof condition.level === 'number'
      ? currentPrice >= condition.level ? 'matched' : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_below' || condition.type === 'price_reject_level') {
    return typeof condition.level === 'number'
      ? currentPrice <= condition.level ? 'matched' : 'failed'
      : 'unknown';
  }
  if (condition.type === 'price_in_zone') {
    return typeof condition.zone_low === 'number' && typeof condition.zone_high === 'number'
      ? currentPrice >= condition.zone_low && currentPrice <= condition.zone_high ? 'matched' : 'failed'
      : 'unknown';
  }
  return 'unknown';
}

function primaryTriggerLevel(playbook: ScenarioDecisionPlaybook): number | null {
  const condition = playbook.entry_conditions.find((item) => typeof item.level === 'number');
  return condition?.level ?? null;
}

function conditionFromTriggerSpec(spec: JsonRecord): ScenarioDecisionCondition {
  return {
    type: conditionTypeValue(spec.type),
    level: nullableNumber(spec.level) ?? undefined,
    zone_low: nullableNumber(spec.zone_low) ?? undefined,
    zone_high: nullableNumber(spec.zone_high) ?? undefined,
    timeframe: stringValue(spec.timeframe) || undefined,
    candle_close_required: booleanValue(spec.candle_close_required),
  };
}

function marketIsStale(snapshot: JsonRecord | null, nowIso: string): boolean {
  const capturedAt = nullableString(snapshot?.captured_at);
  if (!capturedAt) {
    return true;
  }
  const diffMs = Date.parse(nowIso) - Date.parse(capturedAt);
  return Number.isFinite(diffMs) && diffMs > MARKET_STALE_MINUTES * 60 * 1000;
}

function statusReasonFor(
  action: ScenarioRecommendedAction,
  triggerStatus: ScenarioTriggerStatus,
  validityStatus: ScenarioValidityStatus,
  triggerLevel: number | null,
  currentPrice: number | null,
  blockers: string[],
): string {
  if (blockers.length > 0) {
    return `Action ${action} because blockers are present: ${blockers.join(', ')}.`;
  }
  if (triggerStatus === 'triggered') {
    return `Trigger is active at latest price ${currentPrice ?? 'n/a'} against level ${triggerLevel ?? 'n/a'}.`;
  }
  if (triggerStatus === 'near_trigger') {
    return `Scenario is near trigger; wait for confirmation before entry.`;
  }
  return `Scenario is ${triggerStatus} with validity ${validityStatus}.`;
}

function confidenceAfterGates(confidence: number, blockers: string[]): number {
  if (blockers.length === 0) {
    return confidence;
  }
  if (blockers.includes('missing_evidence_refs') || blockers.includes('missing_invalidation')) {
    return Math.min(confidence, 0.5);
  }
  return Math.min(confidence, 0.65);
}

function conditionList(value: unknown): ScenarioDecisionCondition[] {
  return Array.isArray(value)
    ? value.map((item) => conditionFromTriggerSpec(recordValue(item)))
    : [];
}

function evidenceRefList(value: unknown): ScenarioEvidenceRef[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const record = recordValue(item);
        return {
          type: stringValue(record.type, 'unknown'),
          id: nullableString(record.id),
          field: stringValue(record.field),
          label: stringValue(record.label),
          supports: stringValue(record.supports),
        };
      }).filter((item) => item.field && item.supports)
    : [];
}

function actionValue(value: unknown, fallback: ScenarioRecommendedAction): ScenarioRecommendedAction {
  const action = stringValue(value);
  return [
    'wait',
    'entry_long_now',
    'entry_short_now',
    'consider_long',
    'consider_short',
    'avoid',
    'reduce',
    'exit',
    'review',
  ].includes(action)
    ? (action as ScenarioRecommendedAction)
    : fallback;
}

function actionBiasValue(value: unknown): 'long' | 'short' | 'neutral' | 'unknown' {
  const bias = stringValue(value);
  return bias === 'long' || bias === 'short' || bias === 'neutral' ? bias : 'unknown';
}

function inferredActionBias(scenario: JsonRecord, payload: JsonRecord): 'long' | 'short' | 'neutral' | 'unknown' {
  const text = `${stringValue(scenario.direction)} ${stringValue(payload.direction)} ${stringValue(scenario.condition)} ${stringValue(payload.condition)}`.toLowerCase();
  if (/\b(short|bear|below|breakdown|reject)\b/.test(text)) {
    return 'short';
  }
  if (/\b(long|bull|above|breakout|reclaim)\b/.test(text)) {
    return 'long';
  }
  return 'unknown';
}

function conditionTypeValue(value: unknown): ScenarioDecisionCondition['type'] {
  const type = stringValue(value);
  if (
    type === 'price_above' ||
    type === 'price_below' ||
    type === 'price_in_zone' ||
    type === 'price_reclaim_level' ||
    type === 'price_reject_level' ||
    type === 'volume_above_average' ||
    type === 'overextended_from_trigger'
  ) {
    return type;
  }
  return 'price_above';
}

function conditionLabel(condition: ScenarioDecisionCondition): string {
  if (typeof condition.level === 'number') {
    return `${condition.type}:${condition.level}`;
  }
  if (typeof condition.zone_low === 'number' && typeof condition.zone_high === 'number') {
    return `${condition.type}:${condition.zone_low}-${condition.zone_high}`;
  }
  return condition.type;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = nullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function clampConfidence(value: unknown): number {
  const parsed = nullableNumber(value);
  if (parsed === null) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => nullableString(item)).filter((item): item is string => Boolean(item));
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return String(value).toLowerCase() === 'true';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
```

- [ ] **Step 4: Run typecheck and focused test**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "expired playbooks"
```

Expected after Task 3 contract wiring: typecheck PASS and focused test PASS. At this step, the test may still fail only because `ScenarioResponse` is not wired yet.

---

## Task 3: Wire Runtime Decision Into API Contract

**Files:**
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Extend `ScenarioResponse`**

In `apps/api/src/contracts/frontend-contract.ts`, import the decision types:

```ts
import type {
  ScenarioDecisionPlaybook,
  ScenarioRuntimeDecision,
} from '../scenarios/scenario-decision.types';
```

Add these fields to `ScenarioResponse`:

```ts
  decision_playbook: ScenarioDecisionPlaybook | null;
  runtime_decision: ScenarioRuntimeDecision;
```

- [ ] **Step 2: Add default runtime helpers**

Near the scenario helper functions in `frontend-contract.ts`, add:

```ts
function scenarioDecisionPlaybookValue(value: unknown): ScenarioDecisionPlaybook | null {
  const record = recordValue(value);
  return record.version === 'scenario_decision_playbook.v1'
    ? (record as unknown as ScenarioDecisionPlaybook)
    : null;
}

function scenarioRuntimeDecisionValue(value: unknown): ScenarioRuntimeDecision {
  const record = recordValue(value);
  if (record.version === 'scenario_runtime_decision.v1') {
    return record as unknown as ScenarioRuntimeDecision;
  }
  return {
    version: 'scenario_runtime_decision.v1',
    evaluated_at: new Date().toISOString(),
    trigger_status: 'needs_review',
    validity_status: 'needs_review',
    recommended_action: 'review',
    confidence: 0,
    matched_conditions: [],
    failed_conditions: [],
    blocking_reasons: ['runtime_decision_missing'],
    risk_notes: [],
    evidence_refs: [],
    source: 'rule_engine_from_decision_playbook',
    playbook_source: 'missing',
    status_reason: 'Runtime decision has not been evaluated.',
    distance_to_trigger: null,
    llm_recommendation: null,
    final_decision: {
      action: 'review',
      reason: 'Runtime decision has not been evaluated.',
      overrides: ['runtime_decision_missing'],
    },
  };
}
```

- [ ] **Step 3: Update `toScenarioResponse`**

Inside `toScenarioResponse`, after `const payload = ...`, read:

```ts
  const decisionPlaybook = scenarioDecisionPlaybookValue(
    scenario.decision_playbook ?? payload.decision_playbook,
  );
```

Add these fields to the returned object:

```ts
    decision_playbook: decisionPlaybook,
    runtime_decision: scenarioRuntimeDecisionValue(
      scenario.runtime_decision ?? payload.runtime_decision,
    ),
```

- [ ] **Step 4: Run focused test and verify it still fails only because services do not attach runtime decisions**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "expired playbooks"
```

Expected: FAIL because `runtime_decision` defaults to `needs_review`, not `expired`.

---

## Task 4: Evaluate Runtime Decisions In Scenario Monitor

**Files:**
- Modify: `apps/api/src/scenarios/scenarios.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Import runtime evaluator**

In `apps/api/src/scenarios/scenarios.service.ts`, add:

```ts
import { evaluateScenarioRuntimeDecision } from './scenario-runtime-evaluator';
```

- [ ] **Step 2: Attach runtime decision in `buildScenarioMonitorItem`**

In `buildScenarioMonitorItem`, after `const evaluation = evaluateScenario(...)`, add:

```ts
  const runtimeDecision = evaluateScenarioRuntimeDecision(
    scenario,
    snapshot,
    new Date().toISOString(),
  );
```

Add these fields to `evaluatedScenario`:

```ts
    runtime_decision: runtimeDecision,
    decision_playbook: runtimeDecision.playbook_source === 'missing'
      ? null
      : recordValue(payload.decision_playbook),
```

Add these fields inside `evaluatedScenario.payload`:

```ts
      runtime_decision: runtimeDecision,
```

- [ ] **Step 3: Prefer runtime decision for monitor status when no unread alert exists**

Change the status selection to:

```ts
  const status = latestAlert && !latestAlert.read_at
    ? 'alerting'
    : runtimeDecision.trigger_status;
```

Change status reason to:

```ts
    status_reason: status === 'alerting'
      ? statusReason(status, latestAlert, snapshot)
      : runtimeDecision.status_reason,
```

- [ ] **Step 4: Run expired playbook test**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "expired playbooks"
```

Expected: PASS.

- [ ] **Step 5: Add test for near trigger cannot entry now**

Append near the same tests:

```ts
test('scenario runtime decision treats near trigger as consider only', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_near_runtime', 'workspace_a'), {
    id: 'thesis_near_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_near_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_near_runtime',
      thesisId: 'thesis_near_runtime',
      validUntil: '2026-06-10T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_near_runtime', 'workspace_a'), {
    id: 'snap_bnb_near_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 612,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'near_trigger');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'consider_long');
});
```

Add this fixture helper near existing test helpers:

```ts
function runtimeScenarioFixture(input: {
  id: string;
  thesisId: string;
  validUntil: string;
  preferred: string;
  confidence: number;
}): JsonRecord {
  return {
    id: input.id,
    workspace_id: 'workspace_a',
    thesis_id: input.thesisId,
    scenario_name: 'Runtime reclaim',
    condition: 'BNB/USDT reclaims 620.',
    invalidation: 'Invalid below 600.',
    probability_band: 'medium',
    payload: {
      trigger_spec: { type: 'price_above', level: 620 },
      decision_playbook: {
        version: 'scenario_decision_playbook.v1',
        source: 'llm',
        generated_at: '2026-06-07T00:00:00.000Z',
        generated_from_run_id: 'run_runtime',
        action_bias: 'long',
        confidence: input.confidence,
        preferred_action_if_triggered: input.preferred,
        fallback_action: 'wait',
        near_trigger_threshold_pct: 2,
        validity_window: {
          valid_from: '2026-06-07T00:00:00.000Z',
          valid_until: input.validUntil,
          timeframe: '1D',
          rationale: 'Runtime fixture validity window.',
          refresh_policy: 'refresh_on_next_research_run',
        },
        entry_conditions: [{ type: 'price_above', level: 620 }],
        avoid_if: [{ type: 'overextended_from_trigger', threshold_pct: 2.5 }],
        invalidation_conditions: [{ type: 'price_below', level: 600 }],
        wait_for: ['Price above 620.'],
        risk_notes: [],
        evidence_refs: [
          {
            type: 'scenario',
            id: input.id,
            field: 'payload.trigger_spec',
            label: 'Trigger spec',
            supports: 'Trigger level is machine-readable.',
          },
        ],
        rationale: 'Fixture playbook.',
      },
    },
  };
}
```

- [ ] **Step 6: Run scenario runtime focused tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario runtime decision"
```

Expected: PASS.

---

## Task 5: Add Entry-Now Gate Tests

**Files:**
- Modify: `apps/api/test/api-contract.test.ts`
- Modify: `apps/api/src/scenarios/scenario-runtime-evaluator.ts`

- [ ] **Step 1: Add test for triggered valid entry**

Append:

```ts
test('scenario runtime decision allows entry long now only when gates pass', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_entry_runtime', 'workspace_a'), {
    id: 'thesis_entry_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_entry_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_entry_runtime',
      thesisId: 'thesis_entry_runtime',
      validUntil: '2026-06-10T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_entry_runtime', 'workspace_a'), {
    id: 'snap_bnb_entry_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 621,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(monitor.items[0]?.scenario.runtime_decision.trigger_status, 'triggered');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.validity_status, 'valid');
  assert.equal(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
  assert.deepEqual(monitor.items[0]?.scenario.runtime_decision.blocking_reasons, []);
});
```

- [ ] **Step 2: Add test for overextended downgrade**

Append:

```ts
test('scenario runtime decision downgrades entry when price is overextended', async () => {
  const { journal, scenarios } = buildHarness();
  journal.theses.set(key('thesis_overextended_runtime', 'workspace_a'), {
    id: 'thesis_overextended_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    thesis_text: 'Watch BNB reclaim.',
  });
  journal.scenarios.set(key('thesis_overextended_runtime', 'workspace_a'), [
    runtimeScenarioFixture({
      id: 'scenario_overextended_runtime',
      thesisId: 'thesis_overextended_runtime',
      validUntil: '2026-06-10T00:00:00.000Z',
      preferred: 'entry_long_now',
      confidence: 0.82,
    }),
  ]);
  journal.marketSnapshots.set(key('snap_bnb_overextended_runtime', 'workspace_a'), {
    id: 'snap_bnb_overextended_runtime',
    workspace_id: 'workspace_a',
    symbol: 'BNB/USDT',
    current_price: 640,
    captured_at: new Date().toISOString(),
    source: 'test',
  });

  const monitor = await scenarios.monitor(
    { symbol: 'BNB/USDT', limit: 20 },
    'user_1',
    'workspace_a',
  );

  assert.equal(
    monitor.items[0]?.scenario.runtime_decision.blocking_reasons.includes('overextended'),
    true,
  );
  assert.notEqual(monitor.items[0]?.scenario.runtime_decision.recommended_action, 'entry_long_now');
});
```

- [ ] **Step 3: Run tests and adjust evaluator only if assertions fail**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "entry long now|overextended"
```

Expected: PASS. If the overextended test fails, inspect `isOverextended()` and ensure it evaluates after the primary entry condition is matched.

---

## Task 6: Wire Runtime Decisions Into Workbench

**Files:**
- Modify: `apps/api/src/workbench/workbench.service.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add failing workbench runtime assertion**

Extend the existing test `workbench attention includes active scenarios ordered by monitor urgency` with:

```ts
  assert.equal(response.active_scenarios[0]?.runtime_decision.trigger_status, 'near_trigger');
  assert.equal(response.active_scenarios[0]?.runtime_decision.recommended_action, 'consider_long');
```

- [ ] **Step 2: Import runtime evaluator**

In `apps/api/src/workbench/workbench.service.ts`, add:

```ts
import { evaluateScenarioRuntimeDecision } from '../scenarios/scenario-runtime-evaluator';
```

- [ ] **Step 3: Attach runtime decision where active scenarios are evaluated**

In the active scenario builder loop, after the existing `evaluateScenario(...)` call, add:

```ts
        const runtimeDecision = evaluateScenarioRuntimeDecision(
          scenario,
          snapshot,
          nowIso,
        );
```

Add to the object passed into `toScenarioResponse`:

```ts
          runtime_decision: runtimeDecision,
          payload: {
            ...recordValue(scenario.payload ?? scenario.payload_json),
            status: evaluation.status,
            status_reason: evaluation.status_reason,
            distance_to_trigger: evaluation.distance_to_trigger,
            last_evaluated_at: evaluation.last_evaluated_at,
            trigger_spec: evaluation.trigger_spec,
            runtime_decision: runtimeDecision,
          },
```

- [ ] **Step 4: Update active scenario urgency**

In `activeScenarioUrgency`, prefer runtime decision:

```ts
function activeScenarioUrgency(scenario: ScenarioResponse): number {
  const action = scenario.runtime_decision.recommended_action;
  if (action === 'entry_long_now' || action === 'entry_short_now') return 100;
  if (action === 'consider_long' || action === 'consider_short') return 85;
  if (scenario.runtime_decision.trigger_status === 'triggered') return 80;
  if (scenario.runtime_decision.trigger_status === 'near_trigger') return 70;
  if (scenario.runtime_decision.validity_status === 'expired') return 50;
  return 10;
}
```

- [ ] **Step 5: Run focused workbench test**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "active scenarios ordered"
```

Expected: PASS.

---

## Task 7: Update Frontend Types

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`

- [ ] **Step 1: Add frontend decision types**

In both files, near `ScenarioResponse`, add:

```ts
export type ScenarioTriggerStatus =
  | 'watching'
  | 'near_trigger'
  | 'triggered'
  | 'stale'
  | 'missing_price'
  | 'needs_review';

export type ScenarioValidityStatus =
  | 'valid'
  | 'weakening'
  | 'invalidated'
  | 'expired'
  | 'overextended'
  | 'conflicted'
  | 'needs_review';

export type ScenarioRecommendedAction =
  | 'wait'
  | 'entry_long_now'
  | 'entry_short_now'
  | 'consider_long'
  | 'consider_short'
  | 'avoid'
  | 'reduce'
  | 'exit'
  | 'review';

export interface ScenarioEvidenceRef {
  type: string;
  id: string | null;
  field: string;
  label: string;
  supports: string;
}

export interface ScenarioRuntimeDecision {
  version: 'scenario_runtime_decision.v1';
  evaluated_at: string;
  trigger_status: ScenarioTriggerStatus;
  validity_status: ScenarioValidityStatus;
  recommended_action: ScenarioRecommendedAction;
  confidence: number;
  matched_conditions: string[];
  failed_conditions: string[];
  blocking_reasons: string[];
  risk_notes: string[];
  evidence_refs: ScenarioEvidenceRef[];
  source: 'rule_engine_from_decision_playbook';
  playbook_source: 'llm' | 'derived_v1' | 'missing';
  status_reason: string;
  distance_to_trigger: number | null;
  llm_recommendation: JsonRecord | null;
  final_decision: {
    action: ScenarioRecommendedAction;
    reason: string;
    overrides: string[];
  };
}
```

- [ ] **Step 2: Extend frontend `ScenarioResponse`**

Add to `ScenarioResponse` in both files:

```ts
  decision_playbook: JsonRecord | null;
  runtime_decision: ScenarioRuntimeDecision;
```

- [ ] **Step 3: Run frontend typecheck**

Run:

```powershell
pnpm --filter @lunaperception/web typecheck
```

Expected: PASS or only pre-existing type errors unrelated to scenario runtime types. Fix new missing-property errors before moving on.

---

## Task 8: Update Scenario View Model And Pages

**Files:**
- Modify: `apps/web/src/pages/scenario-view-model.ts`
- Modify: `apps/web/src/pages/ScenarioMonitorPage.tsx`
- Modify: `apps/web/src/pages/WorkbenchPage.tsx`
- Test: `apps/web/test/scenario-monitor-layout.test.ts`

- [ ] **Step 1: Extend view model**

In `apps/web/src/pages/scenario-view-model.ts`, extend `ScenarioViewModel` with:

```ts
  runtimeAction: string;
  triggerStatus: string;
  validityStatus: string;
  runtimeReason: string;
  blockingReasons: string[];
```

In `buildScenarioViewModel`, add:

```ts
    runtimeAction: actionLabel(scenario.runtime_decision.recommended_action),
    triggerStatus: statusLabel(scenario.runtime_decision.trigger_status),
    validityStatus: statusLabel(scenario.runtime_decision.validity_status),
    runtimeReason: cleanText(scenario.runtime_decision.status_reason),
    blockingReasons: scenario.runtime_decision.blocking_reasons.map(cleanText).filter(Boolean),
```

Add helpers:

```ts
function actionLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}
```

- [ ] **Step 2: Update Scenario Monitor rendering**

In `ScenarioMonitorPage.tsx`, inside `ScenarioMonitorCard`, render runtime decision near the status row:

```tsx
<span className="badge scenario-status-badge">{vm.runtimeAction}</span>
<span className="badge">{vm.triggerStatus}</span>
<span className="badge">{vm.validityStatus}</span>
```

Use `vm.runtimeReason` in the status/reason block:

```tsx
<p>{vm.runtimeReason || statusReason || 'Scenario is monitored with latest persisted market context.'}</p>
```

- [ ] **Step 3: Update Workbench active scenarios copy**

In `WorkbenchPage.tsx`, in the active scenario card, replace the status badge text with:

```tsx
<span className="badge">{scenario.runtime_decision.recommended_action.replaceAll('_', ' ')}</span>
```

Replace the paragraph with:

```tsx
<p>{scenario.runtime_decision.status_reason || scenario.status_reason || scenario.condition}</p>
```

- [ ] **Step 4: Add source-level layout test**

In `apps/web/test/scenario-monitor-layout.test.ts`, add:

```ts
test('scenario monitor renders runtime decision fields', () => {
  const source = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('vm.runtimeAction'), true);
  assert.equal(source.includes('vm.triggerStatus'), true);
  assert.equal(source.includes('vm.validityStatus'), true);
});
```

- [ ] **Step 5: Run frontend focused tests**

Run:

```powershell
pnpm --filter @lunaperception/web test -- scenario-monitor-layout.test.ts thesis-detail-layout.test.ts
```

Expected: PASS for scenario-related tests. If unrelated web tests run because of the package script glob, record the unrelated failures separately and do not change unrelated code in this task.

---

## Task 9: Final Verification

**Files:**
- No planned code changes.

- [ ] **Step 1: Run focused API scenario tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- api-contract.test.ts --test-name-pattern "scenario runtime decision|scenario monitor evaluates trigger distance|active scenarios ordered"
```

Expected: PASS.

- [ ] **Step 2: Run focused API continuity tests**

Run:

```powershell
pnpm --filter @lunaperception/api test -- research-continuity-state.projector.test.ts research-continuity-timeline.presenter.test.ts
```

Expected: PASS. Scenario runtime must not break scenario continuity.

- [ ] **Step 3: Run frontend focused tests**

Run:

```powershell
pnpm --filter @lunaperception/web test -- scenario-monitor-layout.test.ts thesis-detail-layout.test.ts research-continuity-current-view.test.ts
```

Expected: Scenario-related tests PASS. If the package test command runs unrelated files and fails on pre-existing `page-header` or `TopCommandStrip` tests, capture those failures in the final handoff.

- [ ] **Step 4: Run typechecks**

Run:

```powershell
pnpm --filter @lunaperception/api typecheck
pnpm --filter @lunaperception/web typecheck
```

Expected: PASS or documented unrelated pre-existing failures. New scenario runtime types must not be the source of failure.

- [ ] **Step 5: Manual verification**

Start the app using the repository's usual dev server commands, then verify:

```text
1. Open Scenario Monitor.
2. Confirm scenario cards show runtime action, trigger status, and validity status.
3. Confirm near-trigger scenarios show consider/wait, not entry now.
4. Confirm expired scenarios show review with expired blocker.
5. Open Workbench.
6. Confirm active scenarios show runtime decision action and reason.
7. Open Research Continuity.
8. Confirm continuity still shows scenario branches as memory, not as a realtime evaluator.
```

---

## Deferred Work

These are intentionally out of V1:

- Scenario Review Agent for daily research-run review.
- Scenario Decision Agent LLM generation of `decision_playbook`.
- Scheduler-based near-trigger checks.
- Alert persistence and cooldown.
- Telegram/Discord/webhook notification integrations.
- Position tracking and position-aware `exit` or `reduce`.
- News/social/onchain scenario decision context.

---

## Self-Review

**Spec coverage:** This plan covers the agreed V1: playbook storage in `payload.decision_playbook`, read-time deterministic runtime decision, separate trigger/validity/action fields, strict entry gates, expiry handling, no alert persistence on reload, Workbench/Scenario Monitor display, and focused verification.

**Placeholder scan:** No task uses TBD/TODO/fill-in language. Deferred work is explicitly out of scope and not required for V1.

**Type consistency:** Runtime field names are consistent across API and web: `decision_playbook`, `runtime_decision`, `trigger_status`, `validity_status`, `recommended_action`, `blocking_reasons`, and `evidence_refs`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-scenario-decision-runtime-v1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
