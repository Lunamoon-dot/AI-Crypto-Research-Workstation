import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research run workspace labels continuity score as artifact score', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunWorkspacePage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('<span>Artifact score</span>'), true);
  assert.equal(source.includes('<span>Score</span>'), false);
});
