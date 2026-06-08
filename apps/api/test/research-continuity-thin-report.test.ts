import assert from 'node:assert/strict';
import test from 'node:test';
import { ContinuityReportRenderer } from '../src/research-continuity/continuity-report.renderer';

test('continuity thin report keeps captured claims and scenarios available in degraded snapshots', () => {
  const renderer = new ContinuityReportRenderer();
  const report = renderer.render({
    entryType: 'delta',
    generatedAt: '2026-06-09T00:00:00.000Z',
    previousState: null,
    repairContext: null,
    snapshot: {
      data_quality: {
        status: 'degraded',
        score: 0.6,
      },
      tracked_items: [
        {
          type: 'claim',
          text: 'Spot demand still supports upside.',
        },
        {
          type: 'scenario',
          text: 'If BTC reclaims 108k on acceptance.',
        },
      ],
    },
    skippedReason: null,
    events: [],
  });

  assert.deepEqual(
    report.thinReport.sections
      .filter((section) => section.id === 'claims' || section.id === 'scenarios')
      .map((section) => ({
        id: section.id,
        items: section.items,
      })),
    [
      {
        id: 'claims',
        items: ['Spot demand still supports upside.'],
      },
      {
        id: 'scenarios',
        items: ['If BTC reclaims 108k on acceptance.'],
      },
    ],
  );
});
