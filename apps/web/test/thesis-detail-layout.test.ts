import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('thesis detail keeps decision brief focused on user actions', () => {
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
  assert.equal(source.includes('label="Decision"'), true);
  assert.equal(source.includes('label="Action"'), true);
  assert.equal(source.includes('label="Bias"'), true);
  assert.equal(source.includes('Main recommendation'), true);
  assert.equal(source.includes('Entry plan'), true);
  assert.equal(source.includes('No trade currently.'), true);
  assert.equal(source.includes('<RatingBadge'), true);
  assert.equal(source.includes('<DirectionBadge'), true);
  assert.equal(source.includes('Track thesis'), true);
  assert.equal(source.includes('Track this thesis'), false);
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

test('thesis technical audit fields stay out of the primary brief', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('function TechnicalThesisDetails'), true);
  assert.equal(source.includes('<TechnicalThesisDetails'), true);
  assert.equal(source.includes('Technical details'), true);
  assert.equal(source.includes('label="Quant confidence"'), true);
  assert.equal(source.includes('label="Confidence basis"'), true);
  assert.equal(source.includes('label="Data quality"'), true);
});

test('thesis detail consumes backend decision brief fields', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('thesis.decision'), true);
  assert.equal(source.includes('thesis.recommended_action_label'), true);
  assert.equal(source.includes('thesis.market_bias_label'), true);
  assert.equal(source.includes('thesis.entry_plan_status'), true);
  assert.equal(source.includes('thesis.entry_plan_status_label'), true);
  assert.equal(source.includes('thesis.analysis_mode_label'), true);
  assert.equal(source.includes('thesis.thesis_status_label'), true);
  assert.equal(source.includes('function summarizeDecision'), false);
});

test('scenario radar strips parser heading artifacts from decision cards', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('function isScenarioSectionArtifact'), true);
  assert.equal(source.includes('chips & watch triggers'), true);
  assert.equal(source.includes('source & timeframe'), true);
  assert.equal(source.includes('function extractScenarioSourceLabel'), true);
  assert.equal(source.includes('actionParts.detail || actionParts.label'), true);
  assert.equal(source.includes('Action Watch'), false);
});
