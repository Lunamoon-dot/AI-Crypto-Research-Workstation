import assert from 'node:assert/strict';
import test from 'node:test';
import { renderScenarioOverlays } from '../src/components/scenarios/scenario-chart-overlays.ts';
import type { ScenarioChartOverlay } from '../src/types/index.ts';

test('renderScenarioOverlays renders watch zone boundaries', () => {
  const priceLines: unknown[] = [];
  const markers: unknown[][] = [];
  const overlays: ScenarioChartOverlay[] = [
    {
      id: 'watch_zone',
      type: 'price_zone',
      role: 'watch',
      source: 'decision_playbook',
      price_low: 100,
      price_high: 105,
      label: 'Watch zone',
      status: 'active',
    },
  ];

  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => {
        priceLines.push(input);
        return undefined as never;
      },
      setMarkers: (input: unknown[]) => {
        markers.push(input);
      },
    },
    overlays,
  );

  assert.equal(priceLines.length, 2);
  assert.equal(markers.length, 0);
});

test('renderScenarioOverlays renders event markers through setMarkers', () => {
  const priceLines: unknown[] = [];
  const markers: unknown[][] = [];
  const overlays: ScenarioChartOverlay[] = [
    {
      id: 'event_triggered',
      type: 'event_marker',
      role: 'event',
      source: 'runtime',
      time: '2026-07-02T00:00:00.000Z',
      price: 101,
      label: 'Triggered',
      status: 'passed',
    },
  ];

  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => {
        priceLines.push(input);
        return undefined as never;
      },
      setMarkers: (input: unknown[]) => {
        markers.push(input);
      },
    },
    overlays,
  );

  assert.equal(priceLines.length, 0);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.[0] && typeof markers[0][0], 'object');
});

test('renderScenarioOverlays does not render stale trade overlays when caller excludes them', () => {
  const priceLines: unknown[] = [];
  renderScenarioOverlays(
    {
      createPriceLine: (input: unknown) => {
        priceLines.push(input);
        return undefined as never;
      },
      setMarkers: () => undefined,
    },
    [],
  );
  assert.equal(priceLines.length, 0);
});
