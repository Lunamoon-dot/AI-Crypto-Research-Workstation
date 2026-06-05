import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scenario monitor uses normalized scenario view model', () => {
  const source = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("from './scenario-view-model'"), true);
  assert.equal(source.includes('scenarioMonitorViewModel'), true);
  assert.equal(source.includes('item.scenario.condition || item.trigger_summary'), false);
});
