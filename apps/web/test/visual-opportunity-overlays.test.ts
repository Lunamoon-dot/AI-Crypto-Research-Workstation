import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legacyOverlaysForScenarioChart,
  projectVisualOverlays,
  visualOverlaySummaryItems,
} from '../src/components/scenarios/visual-opportunity-overlays.ts';
import type {
  ScenarioChartOverlay,
  ScenarioChartProjectionResponse,
  VisualOpportunityProjectionV1,
} from '../src/types/index.ts';

test('projectVisualOverlays maps visual projection prices and times into SVG shapes', () => {
  const visual = visualProjectionFixture();
  const shapes = projectVisualOverlays(
    visual,
    {
      width: 400,
      height: 240,
      timeToX: (time) => (
        time === '2026-07-02T00:00:00.000Z' ? 40 :
        time === '2026-07-02T00:15:00.000Z' ? 200 :
        360
      ),
      priceToY: (price) => 240 - price,
    },
    { compact: false },
  );

  const entryZone = shapes.find((shape) => shape.id === 'entry-zone');
  const riskBox = shapes.find((shape) => shape.id === 'risk-box');
  const setupPath = shapes.find((shape) => shape.id === 'setup-path');
  const fillMarker = shapes.find((shape) => shape.id === 'fill-marker');

  assert.deepEqual(entryZone, {
    kind: 'rect',
    id: 'entry-zone',
    role: 'entry',
    x: 40,
    y: 118,
    width: 320,
    height: 4,
    label: 'Entry area',
    status: 'active',
  });
  assert.deepEqual(riskBox, {
    kind: 'rect',
    id: 'risk-box',
    role: 'risk_box',
    x: 40,
    y: 120,
    width: 320,
    height: 20,
    label: 'Risk box',
    status: 'active',
  });
  assert.deepEqual(setupPath, {
    kind: 'path',
    id: 'setup-path',
    role: 'setup_path',
    d: 'M 40 119 L 200 120 L 360 100',
    label: 'Planned setup path',
    status: 'active',
  });
  assert.deepEqual(fillMarker, {
    kind: 'marker',
    id: 'fill-marker',
    role: 'paper_fill',
    x: 200,
    y: 120,
    label: 'Paper fill',
    status: 'passed',
  });
});

test('legacyOverlaysForScenarioChart suppresses duplicate old overlays when visual projection exists', () => {
  const legacy: ScenarioChartOverlay[] = [
    {
      id: 'entry',
      type: 'horizontal_line',
      role: 'entry',
      source: 'trade_playbook',
      price: 120,
      label: 'Entry',
      status: 'active',
    },
    {
      id: 'watch',
      type: 'price_zone',
      role: 'watch',
      source: 'decision_playbook',
      price_low: 110,
      price_high: 115,
      label: 'Watch',
      status: 'active',
    },
  ];
  const projection = chartProjectionFixture({
    visual_projection: visualProjectionFixture(),
    overlays: legacy,
  });

  assert.deepEqual(
    legacyOverlaysForScenarioChart(projection, []),
    [legacy[1]],
  );
  assert.deepEqual(
    legacyOverlaysForScenarioChart(
      chartProjectionFixture({ visual_projection: null, overlays: legacy }),
      [],
    ),
    legacy,
  );
});

test('legacyOverlaysForScenarioChart collapses same-price trigger and invalidation boundaries', () => {
  const legacy: ScenarioChartOverlay[] = [
    {
      id: 'trigger',
      type: 'horizontal_line',
      role: 'trigger',
      source: 'decision_playbook',
      price: 1601.68,
      label: 'Trigger',
      status: 'unknown',
    },
    {
      id: 'invalidation',
      type: 'horizontal_line',
      role: 'invalidation',
      source: 'decision_playbook',
      price: 1601.68,
      label: 'Invalidation',
      status: 'unknown',
    },
  ];
  const overlays = legacyOverlaysForScenarioChart(
    chartProjectionFixture({
      visual_projection: visualProjectionFixture(),
      overlays: legacy,
    }),
    [],
  );

  assert.equal(overlays.length, 1);
  assert.equal(overlays[0]?.type, 'horizontal_line');
  assert.equal(overlays[0]?.price, 1601.68);
  assert.equal(overlays[0]?.label, 'Trigger / Invalidation');
});

test('visualOverlaySummaryItems keeps compact labels dense and avoids raw prediction wording', () => {
  const items = visualOverlaySummaryItems(visualProjectionFixture(), {
    compact: true,
  });

  assert.equal(items.length <= 4, true);
  assert.equal(
    items.some((item) => /prediction|forecast/i.test(`${item.label} ${item.value}`)),
    false,
  );
  assert.equal(items[0]?.label, 'Entry');
});

test('visual opportunity overlays omit current price as a redundant chart annotation', () => {
  const visual = visualProjectionFixture({
    overlays: [
      {
        type: 'line',
        id: 'current-price',
        role: 'current_price',
        points: [
          { time: '2026-07-02T00:00:00.000Z', price: 121 },
          { time: '2026-07-02T00:30:00.000Z', price: 121 },
        ],
        label: 'Current price',
        style: 'solid',
        status: 'active',
        source_ref: {
          type: 'scenario_chart_projection',
          id: 'scenario_a',
          field: 'live_state.current_price',
        },
      },
    ],
  });
  const shapes = projectVisualOverlays(
    visual,
    {
      width: 400,
      height: 240,
      timeToX: () => 40,
      priceToY: () => 120,
    },
    { compact: false },
  );
  const summary = visualOverlaySummaryItems(visual, { compact: false });

  assert.deepEqual(shapes, []);
  assert.deepEqual(summary, []);
});

function visualProjectionFixture(
  overrides: Partial<VisualOpportunityProjectionV1> = {},
): VisualOpportunityProjectionV1 {
  return {
    schema_version: 'visual_opportunity_projection.v1',
    id: 'visual',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_a',
    thesis_id: 'thesis_a',
    symbol: 'BNB/USDT',
    timeframe: '15m',
    generated_at: '2026-07-02T00:30:00.000Z',
    source_versions: {
      trade_playbook_id: 'playbook_a',
      trade_playbook_hash: null,
      simulation_run_id: 'simulation_a',
      scenario_chart_projection_hash: null,
      scenario_chart_generated_at: '2026-07-02T00:30:00.000Z',
      technical_pattern_snapshot_id: null,
    },
    opportunity: {
      kind: 'trade_setup',
      side: 'long',
      status: 'target_hit',
      stale_reasons: [],
    },
    overlays: [
      {
        type: 'zone',
        id: 'entry-zone',
        role: 'entry',
        price_low: 118,
        price_high: 122,
        time_start: '2026-07-02T00:00:00.000Z',
        time_end: '2026-07-02T00:30:00.000Z',
        label: 'Entry area',
        status: 'active',
        source_ref: { type: 'trade_playbook', id: 'playbook_a', field: 'entry' },
      },
      {
        type: 'box',
        id: 'risk-box',
        role: 'risk_box',
        time_start: '2026-07-02T00:00:00.000Z',
        time_end: '2026-07-02T00:30:00.000Z',
        price_low: 100,
        price_high: 120,
        label: 'Risk box',
        status: 'active',
        source_ref: {
          type: 'trade_playbook',
          id: 'playbook_a',
          field: 'invalidation.level',
        },
      },
      {
        type: 'path',
        id: 'setup-path',
        role: 'setup_path',
        path_semantics: 'planned_setup_path',
        points: [
          { time: '2026-07-02T00:00:00.000Z', price: 121 },
          { time: '2026-07-02T00:15:00.000Z', price: 120 },
          { time: '2026-07-02T00:30:00.000Z', price: 140 },
        ],
        label: 'Planned setup path',
        source_ref: { type: 'trade_playbook', id: 'playbook_a', field: 'entry' },
      },
      {
        type: 'marker',
        id: 'fill-marker',
        role: 'paper_fill',
        point: { time: '2026-07-02T00:15:00.000Z', price: 120 },
        label: 'Paper fill',
        status: 'passed',
        source_ref: {
          type: 'execution_event',
          id: 'event_fill',
          field: 'event_type',
        },
      },
    ],
    labels: [],
    warnings: [],
    ...overrides,
  };
}

function chartProjectionFixture(
  overrides: Partial<ScenarioChartProjectionResponse>,
): ScenarioChartProjectionResponse {
  return {
    version: 'scenario_chart_projection.v1',
    workspace_id: 'workspace_a',
    scenario_id: 'scenario_a',
    thesis_id: 'thesis_a',
    mode: 'trade',
    symbol: 'BNB/USDT',
    market_type: 'spot',
    interval: '15m',
    generated_at: '2026-07-02T00:30:00.000Z',
    source_versions: {
      decision_playbook_source: 'llm',
      trade_playbook_id: 'playbook_a',
      trade_playbook_status: 'current',
      stale_reasons: [],
    },
    candles: [],
    overlays: [],
    live_state: {
      version: 'scenario_live_state.v1',
      scenario_id: 'scenario_a',
      workspace_id: 'workspace_a',
      evaluated_at: '2026-07-02T00:30:00.000Z',
      current_price: 121,
      trigger_status: 'triggered',
      validity_status: 'valid',
      recommended_action: 'entry_long_now',
      distance_to_trigger: null,
      condition_evaluations: [],
      target_progress: [],
      blockers: [],
      commentary: 'Scenario is triggered and valid.',
      latest_event: null,
    },
    warnings: [],
    visual_projection: null,
    ...overrides,
  };
}
