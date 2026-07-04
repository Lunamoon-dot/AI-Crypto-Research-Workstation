import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('paper execution UI uses simulation-only action copy', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  for (const forbidden of [
    'Buy',
    'Sell',
    'Place order',
    'Submit order',
    'Auto trade',
    'Connect exchange',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(source.includes('Start simulation'), true);
  assert.equal(source.includes('Run replay'), true);
  assert.equal(source.includes('Close paper position'), true);
  assert.equal(source.includes('Abandon inconclusive'), true);
  assert.equal(source.includes('Expires'), true);
  assert.equal(source.includes('Realized / Unrealized'), true);
  assert.equal(source.includes('Source changed after start'), true);
});
