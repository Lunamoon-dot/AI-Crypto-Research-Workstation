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
  assert.equal(source.includes('Track thesis'), false);
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

test('thesis detail renders typed objective levels instead of legacy target zones', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('const profitTargets ='), true);
  assert.equal(source.includes('const downsideObjectives ='), true);
  assert.equal(source.includes('const accumulationZones ='), true);
  assert.equal(source.includes('const indicatorThresholds ='), true);
  assert.equal(source.includes('normalizeThesisResponse'), true);
  assert.equal(source.includes('title="Profit targets"'), true);
  assert.equal(source.includes('title="Downside objectives"'), true);
  assert.equal(source.includes('title="Accumulation zones"'), true);
  assert.equal(source.includes('title="Indicator thresholds"'), true);
  assert.equal(source.includes("thesis.direction.toLowerCase() === 'short'"), true);
  assert.equal(source.includes('title="Target zones"'), false);
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
  const pageSource = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes("from './scenario-view-model'"), true);
  assert.equal(pageSource.includes('scenarioDetailViewModel'), true);
  assert.equal(pageSource.includes('payload.as_of ??'), false);
  assert.equal(pageSource.includes('function isScenarioSectionArtifact'), true);
  assert.equal(pageSource.includes('chips & watch triggers'), true);
  assert.equal(pageSource.includes('source & timeframe'), true);
  assert.equal(pageSource.includes('value={vm.asOf}'), true);
  assert.equal(pageSource.includes('value={vm.timeframe}'), true);
  assert.equal(pageSource.includes('value={vm.source}'), true);
  assert.equal(pageSource.includes('vm.actionDetail || vm.actionLabel'), true);
  assert.equal(pageSource.includes('Action Watch'), false);
  assert.equal(viewModelSource.includes('function cleanText'), true);
  assert.equal(viewModelSource.includes('Source,\\s*timeframe'), true);
});

test('scenario radar ignores missing runtime decisions for primary actions', () => {
  const source = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('hasRuntimeDecision'), true);
  assert.equal(source.includes("playbook_source !== 'missing'"), true);
  assert.equal(source.includes('runtime_decision_missing'), true);
  assert.equal(
    source.includes("actionLabel: runtimeAction || recommendationAction || action.label || 'Review'"),
    true,
  );
});

test('scenario radar renders recommendation state from shared view model', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );
  const viewModelSource = readFileSync(
    new URL('../src/pages/scenario-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('<span>Recommendation</span>'), true);
  assert.equal(pageSource.includes('Hard gates'), true);
  assert.equal(pageSource.includes('Blocking reasons'), true);
  assert.equal(pageSource.includes('<span>Evaluation</span>'), true);
  assert.equal(pageSource.includes('<span>Reliability</span>'), true);
  assert.equal(pageSource.includes('<span>Playbook</span>'), true);
  assert.equal(viewModelSource.includes('scenario.scenario_recommendation'), true);
  assert.equal(viewModelSource.includes('recommendationSummary'), true);
  assert.equal(viewModelSource.includes('evaluationLabel'), true);
  assert.equal(viewModelSource.includes('reliabilityLabel'), true);
  assert.equal(viewModelSource.includes('playbookLabel'), true);
  assert.equal(viewModelSource.includes('backtestLabel'), true);
  assert.equal(viewModelSource.includes('backtestEvents'), true);
  assert.equal(pageSource.includes('vm.backtestEvents'), true);
});

test('scenario radar exposes lifecycle actions on persisted scenario cards', () => {
  const pageSource = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );
  const styles = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );
  const serviceSource = readFileSync(
    new URL('../src/services/scenario-decision.ts', import.meta.url),
    'utf8',
  );

  assert.equal(pageSource.includes('compileScenarioDecisionPlaybook'), true);
  assert.equal(pageSource.includes('ScenarioLifecycleActions'), true);
  assert.equal(pageSource.includes('persistedScenarioId'), true);
  assert.equal(pageSource.includes('Playbook rejected.'), true);
  assert.equal(pageSource.includes('Reliability: this scenario window is updated, not double-counted.'), false);
  assert.equal(pageSource.includes('Scope: manual research plan only; no exchange order is placed.'), true);
  assert.equal(pageSource.includes('playbookEntryDetail'), true);
  assert.equal(pageSource.includes('playbookTargetsDetail'), true);
  assert.equal(pageSource.includes('compileBlockerForScenario'), true);
  assert.equal(
    pageSource.includes('compileBlockerForScenario(scenario, chartProjection?.live_state ?? null)'),
    true,
  );
  assert.equal(pageSource.includes('compileBlocker={compileBlocker}'), true);
  assert.equal(pageSource.includes('const runtimeBlockers = liveState?.blockers'), true);
  assert.equal(pageSource.includes('disabled={pending || Boolean(compileBlocker)}'), true);
  assert.equal(pageSource.includes('title={compileBlocker ?? undefined}'), true);
  assert.equal(pageSource.includes('Scenario is invalidated.'), true);
  assert.equal(pageSource.includes('Recommendation action is wait/review.'), true);
  assert.equal(pageSource.includes('Scenario is watch-only or not directional.'), true);
  assert.equal(pageSource.includes('backtestBlockerForPlaybook'), false);
  assert.equal(serviceSource.includes('lastClosedDailyBacktestEnd'), false);
  assert.equal(pageSource.includes('feedback.details.slice(0, 5)'), false);
  assert.equal(pageSource.includes('rejection_reasons'), true);
  assert.equal(pageSource.includes('queryKeys.scenarioDecisionWorkbench()'), false);
  assert.equal(pageSource.includes('queryKeys.thesisScenarios(thesisId)'), true);
  assert.equal(styles.includes('.scenario-lifecycle-actions'), true);
  assert.equal(styles.includes('.scenario-action-result-warning'), true);
});

test('paper simulation panel avoids opportunity copy for watch and simulation states', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('Opportunity'), false);
  assert.equal(source.includes('Watch setup'), true);
  assert.equal(source.includes('Simulation'), true);
  assert.equal(source.includes('Trade-lab paper simulation supports perp artifacts only.'), true);
  assert.equal(source.includes("if (playbook.market_type !== 'perp')"), true);
});

test('paper replay defaults anchor to scenario timing instead of rolling seven-day backtest windows', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('defaultReplaySimulationRequest(scenario)'), true);
  assert.equal(source.includes('scenario.scenario_recommendation?.evaluation_window.starts_at'), true);
  assert.equal(source.includes('scenario.scenario_recommendation?.evaluation_window.ends_at'), true);
  assert.equal(source.includes('startsAt.setUTCDate(startsAt.getUTCDate() - 7)'), false);
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
  assert.equal(source.includes('scenario_recommendation: recommendation,'), true);
  assert.equal(source.includes('runtime_decision: runtimeDecision,'), true);
  assert.equal(source.includes('function buildBoundaryScenarioRecommendation('), true);
  assert.equal(source.includes('function buildBoundaryRuntimeDecision('), true);
  assert.equal(source.includes('scenario_recommendation: null'), false);
  assert.equal(source.includes('runtime_decision: {'), false);
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

test('scenario radar signals relation to the current thesis', () => {
  const source = readFileSync(
    new URL('../src/pages/ThesisDetailPage.tsx', import.meta.url),
    'utf8',
  );
  const styles = readFileSync(
    new URL('../src/styles/index.css', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('thesis={thesis}'), true);
  assert.equal(source.includes('scenarioThesisRelation'), true);
  assert.equal(source.includes('scenario-thesis-link'), true);
  assert.equal(source.includes('scenario.relation_to_thesis'), true);
  assert.equal(source.includes('current LONG thesis'), true);
  assert.equal(source.includes('label: `Supports ${thesisLabel}`'), true);
  assert.equal(source.includes('label: `Challenges ${thesisLabel}`'), true);
  assert.equal(source.includes('label: `Invalidates ${thesisLabel}`'), true);
  assert.equal(source.includes('scenario.thesis_impact'), true);
  assert.equal(styles.includes('.scenario-thesis-link'), true);
  assert.equal(styles.includes('.scenario-thesis-link-risk'), true);
});
