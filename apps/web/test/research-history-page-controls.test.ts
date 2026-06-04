import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research history date filter defaults to all dates', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchHistoryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("useState('')"), true);
  assert.equal(source.includes('todayIsoDate'), false);
  assert.equal(source.includes('history-date-filter-row'), true);
  assert.equal(source.includes("setStartedDate('')"), true);
  assert.equal(source.includes('>All</button>'), true);
});

test('research history hides symbol filters for fixed-symbol workspaces', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchHistoryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('fixedWorkspaceSymbol'), true);
  assert.equal(source.includes('effectiveSymbolFilter'), true);
  assert.equal(source.includes('!fixedWorkspaceSymbol ?'), true);
  assert.equal(source.includes('Workspace symbol'), true);
});

test('research history filter panel does not render quick view shortcuts', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchHistoryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('Quick view'), false);
  assert.equal(source.includes("onClick={() => setStatus('running')}"), false);
  assert.equal(source.includes("onClick={() => setSearch('degraded')}"), false);
  assert.equal(source.includes('onClick={clearFilters}'), false);
  assert.equal(source.includes('function clearFilters()'), false);
});

test('research history exposes cancellation for queued and running runs', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchHistoryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('cancelJob'), true);
  assert.equal(source.includes('useMutation'), true);
  assert.equal(source.includes('useQueryClient'), true);
  assert.equal(source.includes('canCancelRun(run)'), true);
  assert.equal(
    source.includes("run.status === 'queued' ||") &&
      source.includes("run.status === 'running' ||") &&
      source.includes("run.status === 'created' ||") &&
      source.includes("run.status === 'submitted'"),
    true,
  );
  assert.equal(source.includes('queryKeys.researchRunsRoot()'), true);
  assert.equal(source.includes('Cancel run'), true);
  assert.equal(source.includes('Stop run'), true);
  assert.equal(source.includes('Stop requested'), true);
});
