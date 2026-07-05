import type { JsonRecord } from '../database/journal.types';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type { ScenarioDecisionPlaybook } from './scenario-decision.types';
import {
  firstPriceZoneFromText,
  normalizeScenarioConditionText,
} from './scenario-text-conditions';

type Direction = 'long' | 'short' | null;

export function multiStageSetupRequiresSequence(input: {
  direction: Direction;
  entryLevel: number | null;
  conditions?: unknown[];
  textSources?: unknown[];
}): boolean {
  if (!input.direction || input.entryLevel === null) {
    return false;
  }
  return setupZones(input.conditions ?? [], input.textSources ?? []).some((zone) =>
    input.direction === 'short'
      ? zone.low > input.entryLevel!
      : zone.high < input.entryLevel!,
  );
}

export function tradePlaybookRequiresSequencedSetup(
  playbook: TradePlaybookResponse,
  decisionPlaybook: ScenarioDecisionPlaybook | JsonRecord | null,
): boolean {
  return multiStageSetupRequiresSequence({
    direction: playbook.direction === 'short' ? 'short' : 'long',
    entryLevel: tradePlaybookEntryLevel(playbook),
    conditions: entryConditionsFromDecisionPlaybook(decisionPlaybook),
  });
}

export function conditionEntryLevel(
  condition: JsonRecord | null,
  direction: Direction,
): number | null {
  if (!condition || !direction) {
    return null;
  }
  return numberOrNull(
    condition.level ??
      (direction === 'long' ? condition.zone_high : condition.zone_low),
  );
}

function setupZones(
  conditions: unknown[],
  textSources: unknown[],
): Array<{ low: number; high: number }> {
  const zones: Array<{ low: number; high: number }> = [];
  for (const item of conditions) {
    const condition = recordValue(item);
    const role = String(condition.role ?? '');
    if (
      condition.type !== 'price_in_zone' ||
      (role !== 'watch' && role !== 'confirmation')
    ) {
      continue;
    }
    const zone = zoneFromRecord(condition);
    if (zone) {
      zones.push(zone);
    }
  }
  for (const text of sequencedTextSources(textSources)) {
    const zone = firstPriceZoneFromText(text);
    if (zone) {
      zones.push({
        low: Math.min(zone.zone_low, zone.zone_high),
        high: Math.max(zone.zone_low, zone.zone_high),
      });
    }
  }
  return zones;
}

function sequencedTextSources(values: unknown[]): string[] {
  return values
    .map((value) => String(value ?? '').trim())
    .filter((text) => {
      if (!text) {
        return false;
      }
      const normalized = normalizeScenarioConditionText(text);
      return /\b(after|then|sau|truoc|before|reject|trap|reversal|roi)\b/.test(
        normalized,
      );
    });
}

function entryConditionsFromDecisionPlaybook(
  decisionPlaybook: ScenarioDecisionPlaybook | JsonRecord | null,
): unknown[] {
  if (!decisionPlaybook || !Array.isArray(decisionPlaybook.entry_conditions)) {
    return [];
  }
  return decisionPlaybook.entry_conditions;
}

function tradePlaybookEntryLevel(
  playbook: TradePlaybookResponse,
): number | null {
  if (playbook.entry.level !== null) {
    return playbook.entry.level;
  }
  return playbook.direction === 'short'
    ? numberOrNull(playbook.entry.zone_low)
    : numberOrNull(playbook.entry.zone_high);
}

function zoneFromRecord(record: JsonRecord): { low: number; high: number } | null {
  const low = numberOrNull(record.zone_low);
  const high = numberOrNull(record.zone_high);
  if (low === null || high === null) {
    return null;
  }
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
