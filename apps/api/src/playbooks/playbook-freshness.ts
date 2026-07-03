import type { JsonRecord } from '../database/journal.types';
import { playbookSourceHashes } from './playbook-source-hash';
import type {
  TradePlaybookResponse,
  TradePlaybookStaleReason,
} from './playbook.types';

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
  if (!hasRequiredSourceHashes(storedHashes)) {
    return {
      ...playbook,
      status: 'unverifiable',
      stale_reasons: ['legacy_playbook_without_source_hashes'],
    };
  }

  const currentHashes = playbookSourceHashes(sources);
  const staleReasons: TradePlaybookStaleReason[] = [];
  addReason(
    staleReasons,
    storedHashes.scenario,
    currentHashes.scenario,
    'source_scenario_changed',
  );
  addReason(
    staleReasons,
    storedHashes.decision_playbook,
    currentHashes.decision_playbook,
    'source_decision_playbook_changed',
  );
  addReason(
    staleReasons,
    storedHashes.recommendation,
    currentHashes.recommendation,
    'source_recommendation_changed',
  );

  if (staleReasons.length === 0) {
    return { ...playbook, status: 'current', stale_reasons: [] };
  }
  return { ...playbook, status: 'stale', stale_reasons: staleReasons };
}

function hasRequiredSourceHashes(value: JsonRecord): boolean {
  return (
    typeof value.scenario === 'string' &&
    value.scenario.length > 0 &&
    typeof value.decision_playbook === 'string' &&
    value.decision_playbook.length > 0 &&
    typeof value.recommendation === 'string' &&
    value.recommendation.length > 0
  );
}

function addReason(
  reasons: TradePlaybookStaleReason[],
  stored: unknown,
  current: string,
  reason: TradePlaybookStaleReason,
): void {
  if (typeof stored !== 'string' || stored !== current) {
    reasons.push(reason);
  }
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
