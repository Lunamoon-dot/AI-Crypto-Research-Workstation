import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('top command strip does not render quick research run controls', () => {
  const source = readFileSync(
    new URL('../src/components/navigation/TopCommandStrip.tsx', import.meta.url),
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

test('top command strip limits workspace switcher on research continuity routes', () => {
  const source = readFileSync(
    new URL('../src/components/navigation/TopCommandStrip.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("pathname.startsWith('/research-continuity')"), true);
  assert.equal(source.includes('<WorkspaceSwitcher fixedOnly={fixedSymbolWorkspaceOnly} />'), true);
});
