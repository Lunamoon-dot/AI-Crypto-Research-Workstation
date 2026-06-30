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

test('scenario monitor renders recommendation sections', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('<span>Recommendation</span>'), true);
  assert.equal(pageSource.includes('Hard gates'), true);
  assert.equal(pageSource.includes('Blocking reasons'), true);
  assert.equal(pageSource.includes('<span>Evaluation</span>'), true);
  assert.equal(pageSource.includes('<span>Reliability</span>'), true);
  assert.equal(pageSource.includes('<span>Playbook</span>'), true);
  assert.equal(viewModelSource.includes('recommendationSummary'), true);
  assert.equal(viewModelSource.includes('hardGates'), true);
  assert.equal(viewModelSource.includes('evaluationLabel'), true);
  assert.equal(viewModelSource.includes('latest_evaluation'), true);
  assert.equal(viewModelSource.includes('reliabilityLabel'), true);
  assert.equal(viewModelSource.includes('backtestLabel'), true);
  assert.equal(viewModelSource.includes('backtestEvents'), true);
  assert.equal(pageSource.includes('vm.backtestEvents'), true);
});

test('scenario view model tolerates missing runtime decision', () => {
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(viewModelSource.includes('scenarioRuntimeDecision'), true);
  assert.equal(viewModelSource.includes('missingRuntimeDecision'), true);
  assert.equal(
    viewModelSource.includes("blocking_reasons: ['runtime_decision_missing']"),
    true,
  );
  assert.equal(
    viewModelSource.includes('scenario.runtime_decision.playbook_source'),
    false,
  );
});

test('scenario monitor exposes local horizon filters', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ScenarioMonitorPage.tsx', import.meta.url),
    'utf8',
  );
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('ScenarioHorizonFilter'), true);
  assert.equal(pageSource.includes('horizonFilter'), true);
  assert.equal(pageSource.includes('filteredItems'), true);
  assert.equal(pageSource.includes("value=\"short_term\""), true);
  assert.equal(pageSource.includes("value=\"mid_term\""), true);
  assert.equal(pageSource.includes("value=\"long_term\""), true);
  assert.equal(viewModelSource.includes('horizonLabel'), true);
});
