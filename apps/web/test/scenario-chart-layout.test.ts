import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('scenario chart types include live state and overlay contracts', () => {
  const types = source('../src/types/index.ts');

  assert.equal(types.includes('ScenarioConditionEvaluationResponse'), true);
  assert.equal(types.includes('ScenarioTargetProgressResponse'), true);
  assert.equal(types.includes('ScenarioEventResponse'), true);
  assert.equal(types.includes('ScenarioLiveStateResponse'), true);
  assert.equal(types.includes('ScenarioChartOverlay'), true);
  assert.equal(types.includes('ScenarioChartProjectionResponse'), true);
  assert.equal(types.includes("version: 'scenario_chart_projection.v1'"), true);
  assert.equal(types.includes("type: 'price_zone'"), true);
  assert.equal(types.includes("type: 'horizontal_line'"), true);
  assert.equal(types.includes("type: 'event_marker'"), true);
  assert.equal(types.includes("trade_playbook_status: 'current' | 'stale' | 'superseded' | 'missing'"), true);
});

test('scenario chart service requests projection and refresh endpoints', () => {
  const service = source('../src/services/scenario-chart.ts');
  const generated = source('../src/services/generated/api-client.ts');

  for (const file of [service, generated]) {
    assert.equal(file.includes('/scenarios/${encodeURIComponent(scenarioId)}/chart'), true);
    assert.equal(file.includes("interval: params.interval ?? '15m'"), true);
    assert.equal(file.includes('limit: params.limit ?? 200'), true);
    assert.equal(file.includes('/scenarios/${encodeURIComponent(scenarioId)}/live/refresh'), true);
    assert.equal(file.includes("{ method: 'POST' }"), true);
  }
});

test('scenario chart renders empty state when there are no candles', () => {
  const component = source('../src/components/scenarios/ScenarioChart.tsx');

  assert.equal(component.includes('Loading chart...'), true);
  assert.equal(component.includes('Chart unavailable'), true);
  assert.equal(component.includes('projection.candles.length === 0'), true);
  assert.equal(component.includes('scenario-chart-empty'), true);
});

test('scenario chart renders overlay labels without trade action buttons', () => {
  const component = source('../src/components/scenarios/ScenarioChart.tsx');
  const overlays = source('../src/components/scenarios/scenario-chart-overlays.ts');

  assert.equal(component.includes('createChart'), true);
  assert.equal(component.includes('CandlestickSeries'), true);
  assert.equal(component.includes('renderScenarioOverlays'), true);
  assert.equal(component.includes('projection.overlays'), true);
  assert.equal(component.includes('scenario-chart-overlay-list'), true);
  assert.equal(overlays.includes('createPriceLine'), true);
  assert.equal(overlays.includes("overlay.type === 'price_zone'"), true);
  assert.equal(overlays.includes("overlay.role === 'watch'"), true);
  assert.equal(overlays.includes("overlay.role === 'entry'"), true);
  assert.equal(overlays.includes("overlay.role === 'target'"), true);
  assert.equal(overlays.includes("overlay.role === 'invalidation'"), true);
});

test('scenario chart labels stale playbooks instead of rendering stale trade overlays', () => {
  const component = source('../src/components/scenarios/ScenarioChart.tsx');

  assert.equal(component.includes('Stale playbook'), true);
  assert.equal(component.includes("projection?.source_versions.trade_playbook_status === 'stale'"), true);
  assert.equal(component.includes('trade_playbook_stale'), true);
  assert.equal(component.includes('projection.source_versions.stale_reasons'), true);
});

test('scenario monitor can render a compact scenario chart', () => {
  const monitor = source('../src/pages/ScenarioMonitorPage.tsx');
  const queryKeys = source('../src/services/query-keys.ts');

  assert.equal(monitor.includes("import { ScenarioChart }"), true);
  assert.equal(monitor.includes('getScenarioChartProjection'), true);
  assert.equal(monitor.includes('queryKeys.scenarioChart'), true);
  assert.equal(monitor.includes('refetchInterval: 30_000'), true);
  assert.equal(monitor.includes('refetchIntervalInBackground: true'), true);
  assert.equal(monitor.includes('compact'), true);
  assert.equal(queryKeys.includes('scenarioChart:'), true);
});

test('thesis detail scenario card shows chart status and blockers', () => {
  const page = source('../src/pages/ThesisDetailPage.tsx');

  assert.equal(page.includes("import { ScenarioChart }"), true);
  assert.equal(page.includes('getScenarioChartProjection'), true);
  assert.equal(page.includes('refreshScenarioLiveState'), true);
  assert.equal(page.includes('const chartQuery = useQuery'), true);
  assert.equal(page.includes('const refreshStateMutation = useMutation'), true);
  assert.equal(page.includes('refetchIntervalInBackground: true'), true);
  assert.equal(page.includes('Refresh state'), true);
  assert.equal(page.includes('live_state.blockers'), true);
  assert.equal(page.includes('Review blockers'), true);
});

test('scenario chart has no buy or sell action copy', () => {
  const checkedSources = [
    source('../src/components/scenarios/ScenarioChart.tsx'),
    source('../src/components/scenarios/scenario-chart-overlays.ts'),
    source('../src/services/scenario-chart.ts'),
  ];
  const forbidden = /\b(Buy|Sell|Place order|Execute|Close position)\b/;

  for (const checked of checkedSources) {
    assert.equal(forbidden.test(checked), false);
  }
});
