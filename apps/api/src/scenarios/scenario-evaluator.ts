import type { JsonRecord } from '../database/journal.types';
import { priceTriggerSpecFromText } from './scenario-text-conditions';

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
  | 'price_in_zone'
  | 'price_reclaim_level'
  | 'price_reject_level'
  | 'volume_confirmation';

export interface ScenarioTriggerSpec {
  type: ScenarioTriggerType;
  level?: number;
  zone_low?: number;
  zone_high?: number;
  timeframe?: string;
  confirmation?: JsonRecord;
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
  const triggerSpec = triggerSpecFromValue(scenario.trigger_spec)
    ?? triggerSpecFromValue(payload.trigger_spec)
    ?? inferPriceTrigger(scenario, payload);
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
  const target = triggerTarget(triggerSpec, currentPrice);
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
  const triggerState = triggerStatus(triggerSpec, currentPrice, target);
  const triggered = triggerState.triggered;
  const side = triggerState.side;
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
  const trigger = priceTriggerSpecFromText([
    scenario.condition,
    payload.condition,
    scenario.watch_triggers,
    payload.watch_triggers,
    payload.watchTriggers,
    payload.watch,
    scenario.expected_behavior,
    scenario.expected_market_behavior,
    payload.expected_behavior,
    payload.expected_market_behavior,
  ]);
  return trigger ? trigger as unknown as ScenarioTriggerSpec : null;
}

function triggerSpecFromValue(value: unknown): ScenarioTriggerSpec | null {
  const record = recordValue(value);
  const type = stringValue(record.type) as ScenarioTriggerType;
  if (![
    'price_above',
    'price_below',
    'price_in_zone',
    'price_reclaim_level',
    'price_reject_level',
    'volume_confirmation',
  ].includes(type)) {
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

function triggerTarget(
  triggerSpec: ScenarioTriggerSpec,
  currentPrice: number,
): number | null {
  if (typeof triggerSpec.level === 'number') {
    return triggerSpec.level;
  }
  if (
    triggerSpec.type === 'price_in_zone' &&
    typeof triggerSpec.zone_low === 'number' &&
    typeof triggerSpec.zone_high === 'number'
  ) {
    const low = Math.min(triggerSpec.zone_low, triggerSpec.zone_high);
    const high = Math.max(triggerSpec.zone_low, triggerSpec.zone_high);
    if (currentPrice < low) return low;
    if (currentPrice > high) return high;
    return currentPrice;
  }
  return triggerSpec.zone_high ?? triggerSpec.zone_low ?? null;
}

function triggerStatus(
  triggerSpec: ScenarioTriggerSpec,
  currentPrice: number,
  target: number,
): { triggered: boolean; side: string } {
  if (
    triggerSpec.type === 'price_in_zone' &&
    typeof triggerSpec.zone_low === 'number' &&
    typeof triggerSpec.zone_high === 'number'
  ) {
    const low = Math.min(triggerSpec.zone_low, triggerSpec.zone_high);
    const high = Math.max(triggerSpec.zone_low, triggerSpec.zone_high);
    if (currentPrice >= low && currentPrice <= high) {
      return { triggered: true, side: 'inside' };
    }
    return {
      triggered: false,
      side: currentPrice < target ? 'below' : 'above',
    };
  }
  const wantsAbove = ['price_above', 'price_reclaim_level'].includes(triggerSpec.type);
  return {
    triggered: wantsAbove ? currentPrice >= target : currentPrice <= target,
    side: wantsAbove
      ? currentPrice < target
        ? 'below'
        : 'above'
      : currentPrice > target
        ? 'above'
        : 'below',
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
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(4);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
