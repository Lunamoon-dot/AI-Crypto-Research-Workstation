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
  const levelMatch = text.match(/\b(?:above|over|reclaim(?:s)?|vuot|tren)\s+\$?(\d+(?:\.\d+)?)/i);
  if (levelMatch) {
    return { type: 'price_above', level: Number(levelMatch[1]) };
  }
  const belowMatch = text.match(/\b(?:below|under|break(?:s)? below|duoi)\s+\$?(\d+(?:\.\d+)?)/i);
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
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(4);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
