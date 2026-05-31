import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('thesis library date filter defaults to all dates', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisLibraryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("useState('')"), true);
  assert.equal(source.includes('todayIsoDate'), false);
  assert.equal(source.includes('thesis-date-filter-row'), true);
  assert.equal(source.includes("setCreatedDate('')"), true);
  assert.equal(source.includes('>All</button>'), true);
});

test('thesis library hides symbol filters for fixed-symbol workspaces', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisLibraryPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('fixedWorkspaceSymbol'), true);
  assert.equal(source.includes('effectiveSymbolFilter'), true);
  assert.equal(source.includes('!fixedWorkspaceSymbol ?'), true);
  assert.equal(source.includes('Workspace symbol'), true);
});
