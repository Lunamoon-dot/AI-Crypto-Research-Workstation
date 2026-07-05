import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scenario decision workbench has route navigation and API service', () => {
  const page = readFileSync(
    new URL('../src/pages/ScenarioDecisionWorkbenchPage.tsx', import.meta.url),
    'utf8',
  );
  const service = readFileSync(
    new URL('../src/services/scenario-decision.ts', import.meta.url),
    'utf8',
  );
  const routes = readFileSync(
    new URL('../src/routes/index.tsx', import.meta.url),
    'utf8',
  );
  const nav = readFileSync(
    new URL('../src/navigation/nav-groups.ts', import.meta.url),
    'utf8',
  );

  assert.equal(page.includes('getScenarioDecisionWorkbench'), true);
  assert.equal(page.includes('resolveScenarioDecisionItem'), true);
  assert.equal(page.includes('snoozeScenarioDecisionItem'), true);
  assert.equal(page.includes('compileScenarioDecisionPlaybook'), true);
  assert.equal(page.includes('ScenarioDecisionQueueItemResponse'), true);
  assert.equal(service.includes('/scenario-decision/workbench'), true);
  assert.equal(service.includes('/resolve'), true);
  assert.equal(service.includes('/snooze'), true);
  assert.equal(service.includes('/playbook'), true);
  assert.equal(routes.includes('ScenarioDecisionWorkbenchPage'), true);
  assert.equal(routes.includes("path: 'scenario-decision'"), true);
  assert.equal(nav.includes('scenario-decision'), true);
  assert.equal(nav.includes('Decision Queue'), true);
});

test('scenario decision workbench renders priority and next action fields', () => {
  const page = readFileSync(
    new URL('../src/pages/ScenarioDecisionWorkbenchPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(page.includes('Priority {item.priority}'), true);
  assert.equal(page.includes('<span>Next action</span>'), true);
  assert.equal(page.includes('<span>Blockers</span>'), true);
  assert.equal(page.includes('itemPrimaryAction'), true);
  assert.equal(page.includes('Compile playbook'), true);
  assert.equal(page.includes('Run backtest'), false);
  assert.equal(page.includes('Evaluate'), false);
  assert.equal(page.includes('No scenario decision items are open.'), true);
  assert.equal(page.includes('Queue items open when a scenario is triggered'), true);
  assert.equal(page.includes('routes.thesis(item.thesis_id)'), true);
  assert.equal(page.includes('routes.scenarios'), true);
});

test('generated client sends scenario reliability rebuild filters as query params', () => {
  const client = readFileSync(
    new URL('../src/services/generated/api-client.ts', import.meta.url),
    'utf8',
  );

  const start = client.indexOf('rebuildScenarioReliability');
  const end = client.indexOf('compileScenarioPlaybook', start);
  const snippet = client.slice(start, end);

  assert.equal(snippet.includes('query:'), true);
  assert.equal(snippet.includes('body'), false);
});
