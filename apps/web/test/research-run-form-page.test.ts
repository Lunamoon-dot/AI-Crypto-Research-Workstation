import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research run form page uses workspace-scoped target controls', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunFormPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('fixedWorkspaceSymbol'), true);
  assert.equal(source.includes('legacyMixedWorkspace'), true);
  assert.equal(
    source.includes('Create a fixed-symbol workspace to run research'),
    true,
  );
  assert.equal(source.includes('symbol: fixedWorkspaceSymbol ?? normalizedSymbol'), true);
  assert.equal(source.includes('launch-workspace-target'), true);
  assert.equal(source.includes('symbolPresets'), false);
});
