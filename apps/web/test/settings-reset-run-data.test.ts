import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('settings exposes current-workspace run data reset control', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/SettingsPage.tsx', import.meta.url),
    'utf8',
  );
  const serviceSource = readFileSync(
    new URL('../src/services/research-runs.ts', import.meta.url),
    'utf8',
  );
  const generatedClientSource = readFileSync(
    new URL('../src/services/generated/api-client.ts', import.meta.url),
    'utf8',
  );

  assert.equal(serviceSource.includes('deleteWorkspaceResearchRunData'), true);
  assert.equal(
    generatedClientSource.includes('deleteWorkspaceResearchRunData: ()'),
    true,
  );
  assert.equal(
    generatedClientSource.includes("request<ResearchRunDeletionResponse>('/research-runs',"),
    true,
  );
  assert.equal(pageSource.includes('resetRunDataMutation'), true);
  assert.equal(pageSource.includes('Clear run data'), true);
  assert.equal(pageSource.includes('window.confirm'), true);
  assert.equal(pageSource.includes('queryClient.invalidateQueries()'), true);
});
