import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research history exposes linked run deletion controls', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ResearchHistoryPage.tsx', import.meta.url),
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
  const typeSource = readFileSync(
    new URL('../src/types/index.ts', import.meta.url),
    'utf8',
  );

  assert.equal(serviceSource.includes('deleteResearchRun'), true);
  assert.equal(generatedClientSource.includes('deleteResearchRun: (id: string)'), true);
  assert.equal(generatedClientSource.includes("method: 'DELETE'"), true);
  assert.equal(typeSource.includes('ResearchRunDeletionResponse'), true);
  assert.equal(pageSource.includes('deleteRunMutation'), true);
  assert.equal(pageSource.includes('Delete run'), true);
  assert.equal(pageSource.includes('deleted_count'), true);
  assert.equal(pageSource.includes('window.confirm'), true);
  assert.equal(pageSource.includes('queryKeys.researchRunsRoot()'), true);
});
