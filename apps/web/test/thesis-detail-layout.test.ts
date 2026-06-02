import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('thesis detail keeps status summary inside the brief panel', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('<PageHeader'), false);
  assert.equal(source.includes('HeaderStats'), false);
  assert.equal(source.includes('BentoGrid'), false);
  assert.equal(source.includes('useSearchParams'), true);
  assert.equal(source.includes('THESIS_DETAIL_TABS'), true);
  assert.equal(source.includes('role="tablist"'), true);
  assert.equal(source.includes("activeTab === 'brief'"), true);
  assert.equal(source.includes("activeTab === 'evidence'"), true);
  assert.equal(source.includes("activeTab === 'scenario'"), true);
  assert.equal(source.includes("activeTab === 'journal'"), true);
  assert.equal(source.includes('thesis-brief-kpis'), true);
  assert.equal(source.includes('<RatingBadge'), true);
  assert.equal(source.includes('<DirectionBadge'), true);
  assert.equal(source.includes('<ConfidenceBadge'), true);
});

test('thesis detail counts data gaps from structured summary missing data', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('const dataGaps ='), true);
  assert.equal(source.includes('dataGaps.length'), true);
  assert.equal(source.includes('values={dataGaps}'), true);
  assert.equal(source.includes('thesis.stale_or_missing_data.length'), false);
});

test('thesis detail renders first-class confirmation condition', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('const confirmation ='), true);
  assert.equal(source.includes('thesis.confirmation_condition'), true);
  assert.equal(source.includes('<span>Confirmation</span>'), true);
  assert.equal(source.includes('<p>{confirmation}</p>'), true);
});
