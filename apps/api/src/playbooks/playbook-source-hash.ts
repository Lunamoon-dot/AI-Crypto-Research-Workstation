import { createHash } from 'node:crypto';
import type { JsonRecord } from '../database/journal.types';
import type { TradePlaybookResponse } from './playbook.types';

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
  return omitKeys(recordValue(value), [
    'decision_playbook',
    'evaluation_snapshot',
    'latest_backtest',
    'latest_evaluation',
    'latest_playbook',
    'reliability_profile',
    'runtime_decision',
    'scenario_recommendation',
    'status',
    'trigger_spec',
    'distance_to_trigger',
    'last_evaluated_at',
    'status_reason',
    'current_price',
  ]);
}

function stableRuntimeDecisionSource(value: unknown): unknown {
  return pickKeys(recordValue(value), [
    'version',
    'playbook_source',
    'preferred_action_if_triggered',
    'fallback_action',
    'hard_gate_ids',
    'condition_ids',
    'validity_window',
  ]);
}

function pickKeys(record: JsonRecord, keys: string[]): JsonRecord {
  return Object.fromEntries(
    keys.filter((key) => key in record).map((key) => [key, record[key]]),
  );
}

function omitKeys(record: JsonRecord, keys: string[]): JsonRecord {
  const blocked = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !blocked.has(key)),
  );
}

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
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
