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
    scenario: sourceHash(input.scenario),
    decision_playbook: sourceHash(input.decisionPlaybook),
    recommendation: sourceHash(input.recommendation),
    runtime_decision: sourceHash(input.runtimeDecision),
  };
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
