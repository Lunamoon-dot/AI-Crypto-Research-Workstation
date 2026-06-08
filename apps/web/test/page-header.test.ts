import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('page header suppresses route headline copy', () => {
  const source = readFileSync(
    new URL('../src/components/research/page-header.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('page-title'), false);
  assert.equal(source.includes('page-description'), false);
  assert.equal(source.includes('eyebrow'), false);
});
