import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeResearchContinuityTab,
  setResearchContinuityTabParam,
} from '../src/pages/research-continuity-tabs.ts';

test('research continuity tabs normalize and preserve query context', () => {
  assert.equal(normalizeResearchContinuityTab(null), 'general');
  assert.equal(normalizeResearchContinuityTab('lifecycle'), 'lifecycle');
  assert.equal(normalizeResearchContinuityTab('repair'), 'repair');
  assert.equal(normalizeResearchContinuityTab('unknown'), 'general');

  const params = new URLSearchParams('symbol=ETH%2FUSDT&tab=general');
  const next = setResearchContinuityTabParam(params, 'repair');

  assert.equal(next.get('symbol'), 'ETH/USDT');
  assert.equal(next.get('tab'), 'repair');
  assert.equal(params.get('tab'), 'general');
});
