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

test('scenario monitor renders runtime decision fields', () => {
  const source = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('vm.runtimeAction'), true);
  assert.equal(source.includes('vm.triggerStatus'), true);
  assert.equal(source.includes('vm.validityStatus'), true);
});

test('scenario monitor shows runtime decision provenance', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('<span>Runtime decision</span>'), true);
  assert.equal(pageSource.includes('vm.runtimeSource'), true);
  assert.equal(viewModelSource.includes('runtimeSource'), true);
  assert.equal(viewModelSource.includes('playbookSourceLabel'), true);
});
