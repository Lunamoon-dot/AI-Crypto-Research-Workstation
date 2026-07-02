import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeThesisResponse } from '../src/services/thesis-response-normalizer.ts';

test('normalizes legacy thesis responses missing typed objective arrays', () => {
  const normalized = normalizeThesisResponse({
    id: 'legacy_thesis',
    workspace_id: 'workspace_a',
    thesis_text: null,
    summary: {
      action_summary: 'Legacy thesis',
      missing_data: undefined,
    },
  } as any);

  assert.equal(normalized.thesis_text, '');
  assert.deepEqual(normalized.target_zones, []);
  assert.deepEqual(normalized.profit_targets, []);
  assert.deepEqual(normalized.downside_objectives, []);
  assert.deepEqual(normalized.accumulation_zones, []);
  assert.deepEqual(normalized.indicator_thresholds, []);
  assert.deepEqual(normalized.stale_or_missing_data, []);
  assert.deepEqual(normalized.monitor_next, []);
  assert.deepEqual(normalized.summary.missing_data, []);
  assert.deepEqual(normalized.summary.profit_targets, []);
  assert.deepEqual(normalized.summary.downside_objectives, []);
  assert.deepEqual(normalized.summary.accumulation_zones, []);
  assert.deepEqual(normalized.summary.indicator_thresholds, []);
});

test('normalizes scalar objective fields into arrays', () => {
  const normalized = normalizeThesisResponse({
    id: 'scalar_thesis',
    workspace_id: 'workspace_a',
    thesis_text: 'Thesis',
    target_zones: '$600',
    profit_targets: '$620',
    summary: {
      target_zones: '$580',
      profit_targets: '$640',
      missing_data: 'liquidations',
    },
  } as any);

  assert.deepEqual(normalized.target_zones, ['$600']);
  assert.deepEqual(normalized.profit_targets, ['$620']);
  assert.deepEqual(normalized.summary.target_zones, ['$580']);
  assert.deepEqual(normalized.summary.profit_targets, ['$640']);
  assert.deepEqual(normalized.summary.missing_data, ['liquidations']);
});
