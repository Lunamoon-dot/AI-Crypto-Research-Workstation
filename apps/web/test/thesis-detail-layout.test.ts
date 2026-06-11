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
  assert.equal(source.includes('<StructuredRichText value={confirmation} />'), true);
});

test('thesis detail uses one structured text renderer across narrative blocks', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('function StructuredRichText'), true);
  assert.equal(source.includes('<StructuredRichText value={actionSummary} />'), true);
  assert.equal(source.includes('<StructuredRichText value={fullThesisText} />'), true);
  assert.equal(source.includes('<StructuredRichText value={entryPlanText} />'), true);
  assert.equal(source.includes('<StructuredRichText value={invalidation} />'), true);
  assert.equal(source.includes('function parseStructuredText'), true);
  assert.equal(source.includes('function splitInlineListItems'), true);
});

test('thesis detail structured text renderer supports thesis markdown primitives', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("kind: 'heading'"), true);
  assert.equal(source.includes("kind: 'rule'"), true);
  assert.equal(source.includes('function renderInlineMarkdown'), true);
  assert.equal(source.includes('function headingTag'), true);
  assert.equal(source.includes('return <hr'), true);
  assert.equal(source.includes('const Tag = headingTag(block.level);'), true);
  assert.equal(source.includes('/\\*\\*(.+?)\\*\\*/g'), true);
  assert.equal(source.includes('/^#{1,6}\\s+/'), true);
  assert.equal(source.includes('/^-{3,}$/'), true);
});

test('thesis detail structured text renderer supports markdown tables', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );
  const styles = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("kind: 'table'"), true);
  assert.equal(source.includes('function findMarkdownTableStart'), true);
  assert.equal(source.includes('function parseMarkdownTable'), true);
  assert.equal(source.includes('function isMarkdownTableSeparator'), true);
  assert.equal(source.includes('function splitMarkdownTableRow'), true);
  assert.equal(source.includes('structured-rich-text-table-wrap'), true);
  assert.equal(source.includes('<table className="structured-rich-text-table">'), true);
  assert.equal(styles.includes('.structured-rich-text-table-wrap'), true);
  assert.equal(styles.includes('overflow-x: auto;'), true);
  assert.equal(styles.includes('.structured-rich-text-table th,'), true);
  assert.equal(styles.includes('overflow-wrap: anywhere;'), true);
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

test('thesis detail surfaces contract validation status near the summary', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('function ThesisContractStatus'), true);
  assert.equal(source.includes('<ThesisContractStatus thesis={thesis} />'), true);
  assert.equal(source.includes('thesis.artifact_status'), true);
  assert.equal(source.includes('thesis.validation_issues'), true);
  assert.equal(source.includes('thesis.degradation_reasons'), true);
  assert.equal(source.includes('thesis.blocked_reasons'), true);
  assert.equal(source.includes('Blocked thesis'), true);
  assert.equal(source.includes('Degraded thesis'), true);
  assert.equal(source.includes('Legacy thesis'), true);
});

test('thesis detail labels compiler text source and blocked diagnostics', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('thesis.thesis_text_source'), true);
  assert.equal(source.includes('Compiled thesis'), true);
  assert.equal(source.includes('Compiled with caveats'), true);
  assert.equal(source.includes('Diagnostic thesis'), true);
  assert.equal(source.includes('Legacy thesis text'), true);
  assert.equal(source.includes('thesis-diagnostic-text'), true);
  assert.equal(source.includes('<StructuredRichText value={fullThesisText} />'), true);
  assert.equal(source.includes('thesis.compiled_sections'), true);
});

test('thesis detail hides validated plan fields for blocked artifacts', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('const showValidatedThesisPlan'), true);
  assert.equal(source.includes('{showValidatedThesisPlan ? ('), true);
  assert.equal(source.includes("thesis.artifact_status !== 'blocked'"), true);
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

  assert.equal(source.includes("from './scenario-view-model'"), true);
  assert.equal(source.includes('scenarioDetailViewModel'), true);
  assert.equal(source.includes('payload.as_of ??'), false);
  assert.equal(source.includes('function isScenarioSectionArtifact'), true);
  assert.equal(source.includes('chips & watch triggers'), true);
  assert.equal(source.includes('source & timeframe'), true);
  assert.equal(source.includes('function extractScenarioSourceLabel'), true);
  assert.equal(source.includes('vm.actionDetail || vm.actionLabel'), true);
  assert.equal(source.includes('Action Watch'), false);
});

test('scenario radar ignores missing runtime decisions for primary actions', () => {
  const source = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('hasRuntimeDecision'), true);
  assert.equal(source.includes("playbook_source !== 'missing'"), true);
  assert.equal(source.includes('runtime_decision_missing'), true);
  assert.equal(source.includes('actionLabel: runtimeAction || action.label'), true);
});

test('scenario radar supplements missing scenario branches from thesis boundaries', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('buildScenarioCards(thesisQuery.data'), true);
  assert.equal(source.includes('function buildScenarioCards('), true);
  assert.equal(source.includes('buildBoundaryScenario('), true);
  assert.equal(source.includes('if (scenarios.length > 0)'), true);
  assert.equal(source.includes('branchType: \'confirmation\''), true);
  assert.equal(source.includes('branchType: \'invalidation\''), true);
});

test('boundary scenarios do not use market type as timeframe metadata', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("timeframe: thesis.summary.market_type || thesis.summary.direction || ''"), false);
});

test('scenario radar exposes local horizon filters', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('ScenarioHorizonFilter'), true);
  assert.equal(source.includes('scenarioHorizonFilter'), true);
  assert.equal(source.includes('filteredScenarioCards'), true);
  assert.equal(source.includes('SCENARIO_HORIZON_FILTER_ORDER'), true);
  assert.equal(source.includes('availableScenarioHorizons.map'), true);
  assert.equal(source.includes('scenarioHorizonOptions'), true);
  assert.equal(source.includes("setScenarioHorizonFilter('all')"), true);
  assert.equal(source.includes('scenarioHorizon(scenario)'), true);
});
