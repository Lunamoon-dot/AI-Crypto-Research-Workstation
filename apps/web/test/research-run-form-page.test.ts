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

test('research run form gates launch until the backend health check is ready', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunFormPage.tsx', import.meta.url),
    'utf8',
  );
  const serviceSource = readFileSync(
    new URL('../src/services/research-runs.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('getApiHealth'), true);
  assert.equal(source.includes('apiReady'), true);
  assert.equal(source.includes('Backend is starting'), true);
  assert.equal(source.includes('mutation.isPending || !apiReady'), true);
  assert.equal(serviceSource.includes('getHealth'), true);
});
