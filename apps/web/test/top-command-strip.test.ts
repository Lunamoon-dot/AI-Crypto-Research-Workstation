import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('sidebar navigation does not render quick research run controls', () => {
  const source = readFileSync(
    new URL('../src/components/navigation/SidebarNav.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('createResearchRun'), false);
  assert.equal(source.includes('researchRunRequestSchema'), false);
  assert.equal(source.includes('Research symbol'), false);
  assert.equal(source.includes('Market type'), false);
  assert.equal(source.includes('Research profile'), false);
  assert.equal(source.includes('top-command-symbol-context'), false);
  assert.equal(source.includes('checkWatchlist'), false);
  assert.equal(source.includes('createDailyBrief'), false);
  assert.equal(source.includes('top-command-form'), false);
  assert.equal(source.includes('>Check<'), false);
  assert.equal(source.includes('>Brief<'), false);
});
