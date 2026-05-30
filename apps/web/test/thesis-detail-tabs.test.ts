import assert from 'node:assert/strict';
import test from 'node:test';

import {
  THESIS_DETAIL_TABS,
  normalizeThesisDetailTab,
  setThesisDetailTabParam,
} from '../src/pages/thesis-detail-tabs.ts';

test('thesis detail tabs expose the four workflow sections', () => {
  assert.deepEqual(
    THESIS_DETAIL_TABS.map((tab) => tab.id),
    ['brief', 'evidence', 'scenario', 'journal'],
  );
  assert.deepEqual(
    THESIS_DETAIL_TABS.map((tab) => tab.label),
    [
      'Thesis brief',
      'Evidence and contradictions',
      'Scenario radar',
      'Manual decision journal',
    ],
  );
});

test('thesis detail tab query state normalizes and preserves params', () => {
  assert.equal(normalizeThesisDetailTab(null), 'brief');
  assert.equal(normalizeThesisDetailTab('unknown'), 'brief');
  assert.equal(normalizeThesisDetailTab('scenario'), 'scenario');

  const params = new URLSearchParams('source=library&tab=evidence');
  const next = setThesisDetailTabParam(params, 'journal');

  assert.equal(next.get('source'), 'library');
  assert.equal(next.get('tab'), 'journal');
});
