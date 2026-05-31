import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research continuity page omits the top ledger summary and loader controls', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchContinuityPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("from '@/components/research/header-stats'"), false);
  assert.equal(source.includes('<HeaderStats'), false);
  assert.equal(source.includes('<PageHeader'), false);
  assert.equal(source.includes('research-continuity-symbol-form'), false);
  assert.equal(source.includes('research-continuity-ledger-masthead'), false);
  assert.equal(source.includes('research-continuity-ledger-ribbon'), false);
  assert.equal(source.includes('Load ledger'), false);
  assert.equal(source.includes('Refresh ledger'), false);
});

test('research continuity loads fixed workspace symbol automatically', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchContinuityPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('fixedWorkspaceSymbol'), true);
  assert.equal(source.includes('fixedWorkspaceSymbol ??'), true);
});
