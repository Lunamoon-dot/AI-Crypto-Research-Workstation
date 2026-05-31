import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('workspace store exposes authoritative metadata and fixed-symbol helpers', () => {
  const source = readFileSync(
    new URL('../src/store/useWorkspaceStore.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('workspace: WorkspaceSummary | null'), true);
  assert.equal(source.includes('setWorkspace: (workspace: WorkspaceSummary) => void'), true);
  assert.equal(source.includes('isLegacyMixedWorkspace'), true);
  assert.equal(source.includes('fixedWorkspaceSymbol'), true);
  assert.equal(source.includes('Legacy Mixed Workspace'), true);
});
