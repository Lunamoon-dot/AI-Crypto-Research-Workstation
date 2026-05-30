import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('research run form does not render header summary cards', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunFormPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('<PageHeader'), false);
  assert.equal(source.includes('HeaderStats'), false);
});
