import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContinuityTimeline } from '../src/research-continuity/continuity-timeline.presenter';
import type { JsonRecord } from '../src/database/journal.types';

test('continuity timeline normalizes lifecycle rows, context filtering, repair overlays, and windowing', () => {
  const entries: JsonRecord[] = [
    entry('entry_repair', 'run_repair', '2026-05-30T05:00:00.000Z', [
      {
        event_type: 'risk_updated',
        item_key: 'risk_funding',
        previous_text: 'Funding is elevated.',
        current_text: 'Funding is extreme.',
        from: {
          type: 'risk',
          item_key: 'risk_funding_old',
          legacy_item_key: 'risk_funding',
          text: 'Funding is elevated.',
        },
        to: {
          type: 'risk',
          item_key: 'risk_funding',
          text: 'Funding is extreme.',
          source_artifact: 'risk_register',
          source_id: 'risk_1',
          source_field: 'text',
        },
        source: {
          status: 'observed_backed',
          source_artifact: 'risk_register',
          source_id: 'risk_1',
          source_field: 'text',
        },
      },
    ], {
      repair: {
        is_repair: true,
        case_type: 'missing_continuity',
        source_entry_id: 'entry_resolved',
        source_run_id: 'run_resolved',
      },
    }),
    entry('entry_reactivated', 'run_reactivated', '2026-05-30T04:00:00.000Z', [
      {
        event_type: 'risk_added',
        item_key: 'risk_funding',
        to: {
          type: 'risk',
          item_key: 'risk_funding',
          text: 'Funding risk returned.',
          source_artifact: 'thesis',
        },
        reason: 'Funding risk returned.',
      },
    ]),
    entry('entry_resolved', 'run_resolved', '2026-05-30T03:00:00.000Z', [
      {
        event_type: 'risk_resolved',
        item_key: null,
        from: {
          type: 'risk',
          legacy_item_key: 'risk_funding',
          text: 'Funding risk resolved.',
        },
        reason: 'Funding normalized.',
      },
      {
        event_type: 'claim_reinforced',
        item_key: 'claim_spot',
        to: {
          type: 'claim',
          item_key: 'claim_spot',
          text: 'Spot demand still supports upside.',
        },
      },
    ]),
    entry('entry_quality', 'run_quality', '2026-05-30T02:00:00.000Z', [], {
      snapshot_quality: {
        status: 'degraded',
        warnings: ['partial artifacts'],
      },
    }),
    entry('entry_added', 'run_added', '2026-05-30T01:00:00.000Z', [
      {
        event_type: 'risk_added',
        item_key: 'risk_funding',
        to: {
          type: 'risk',
          item_key: 'risk_funding',
          text: 'Funding is elevated.',
          source_artifact: 'thesis',
        },
        source: {
          status: 'observed_backed',
          source_artifact: 'thesis',
          source_id: 'risk_0',
          source_field: 'risks',
        },
      },
      {
        event_type: 'mystery_event',
        severity: 'critical',
        reason: 'Unknown events should be ignored safely.',
      },
      {
        event_type: 'claim_added',
        to: {
          type: 'claim',
          text: 'Unkeyed claim is visible as a timeline row only.',
        },
        reason: 'Unkeyed claim.',
      },
    ]),
  ];
  const runs = new Map<string, JsonRecord>([
    ['run_repair', { id: 'run_repair', completed_at: '2026-05-30T05:10:00.000Z' }],
    ['run_reactivated', { id: 'run_reactivated', completed_at: '2026-05-30T04:10:00.000Z' }],
    ['run_resolved', { id: 'run_resolved', completed_at: '2026-05-30T03:10:00.000Z' }],
    ['run_quality', { id: 'run_quality', completed_at: '2026-05-30T02:10:00.000Z' }],
    ['run_added', { id: 'run_added', completed_at: '2026-05-30T01:10:00.000Z' }],
  ]);

  const withoutContext = buildContinuityTimeline({
    entries,
    entryLimit: 5,
    fetchedEntryCount: 6,
    generatedAt: '2026-05-30T06:00:00.000Z',
    includeContext: false,
    runs,
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
  });

  assert.equal(withoutContext.window.truncated, true);
  assert.equal(withoutContext.window.coverage, 'windowed');
  assert.equal(withoutContext.entry_count, 5);
  assert.equal(
    withoutContext.timeline_events.some((event) => event.status === 'context'),
    false,
  );
  assert.equal(
    withoutContext.timeline_events.some((event) => event.event_type === 'mystery_event'),
    false,
  );
  assert.equal(
    withoutContext.timeline_events.some((event) => event.status === 'quality'),
    true,
  );
  assert.equal(
    withoutContext.timeline_events.some((event) => event.stable_item_key === null),
    true,
  );

  const funding = withoutContext.lifecycle_items.find(
    (item) => item.stable_item_key === 'risk_funding',
  );
  assert.ok(funding);
  assert.equal(funding.item_type, 'risk');
  assert.equal(funding.status, 'active');
  assert.equal(funding.first_seen_run_id, 'run_added');
  assert.equal(funding.last_seen_run_id, 'run_reactivated');
  assert.equal(funding.occurrence_count, 3);
  assert.deepEqual(funding.source_artifacts, ['risk_register', 'thesis']);

  const repairEvent = withoutContext.timeline_events.find(
    (event) => event.entry_id === 'entry_repair',
  );
  assert.ok(repairEvent);
  assert.equal(repairEvent.is_repair, true);
  assert.equal(repairEvent.repair_case_type, 'missing_continuity');
  assert.equal(repairEvent.source_entry_id, 'entry_resolved');
  assert.equal(repairEvent.source_run_id, 'run_resolved');
  assert.equal(repairEvent.observed_at, '2026-05-30T03:10:00.000Z');
  assert.equal(repairEvent.recorded_at, '2026-05-30T05:00:00.000Z');
  assert.equal(repairEvent.evidence_status, 'observed_backed');
  assert.equal(repairEvent.source_artifact, 'risk_register');

  const partialQuality = withoutContext.timeline_events.find(
    (event) => event.event_type === 'data_quality_changed',
  );
  assert.ok(partialQuality);
  assert.equal(partialQuality.diff_quality, 'partial');

  const withContext = buildContinuityTimeline({
    entries,
    entryLimit: 5,
    fetchedEntryCount: 5,
    generatedAt: '2026-05-30T06:00:00.000Z',
    includeContext: true,
    runs,
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
  });

  assert.equal(withContext.window.truncated, false);
  assert.equal(withContext.window.coverage, 'complete');
  assert.ok(
    withContext.timeline_events.some(
      (event) => event.event_type === 'claim_reinforced',
    ),
  );
  assert.equal(
    withContext.lifecycle_items.some(
      (item) => item.stable_item_key === 'claim_spot',
    ),
    true,
  );
  const contextOnlyClaim = withContext.lifecycle_items.find(
    (item) => item.stable_item_key === 'claim_spot',
  );
  assert.equal(contextOnlyClaim?.status, 'context');
  assert.equal(contextOnlyClaim?.last_seen_at, '2026-05-30T03:10:00.000Z');
  assert.equal(contextOnlyClaim?.latest_event_type, 'claim_reinforced');
});

test('continuity timeline renders legacy section rows without creating lifecycle items', () => {
  const response = buildContinuityTimeline({
    entries: [
      {
        id: 'entry_legacy',
        workspace_id: 'workspace_a',
        symbol: 'BTC/USDT',
        research_run_id: 'run_legacy',
        current_snapshot_id: null,
        previous_entry_id: null,
        entry_type: 'delta',
        status: 'completed',
        generated_at: '2026-05-30T01:00:00.000Z',
        summary: 'Legacy continuity entry.',
        sections: [
          {
            title: 'Material Changes',
            items: ['Risk updated: Funding stress increased.'],
            empty_state: 'No material changes detected.',
          },
        ],
        events: [],
        snapshot_quality: { status: 'clean' },
        source_run_ids: ['run_legacy'],
        writer_metadata: {},
        payload: { schema_version: 'research_continuity_entry.v1.1' },
      },
    ],
    entryLimit: 50,
    fetchedEntryCount: 1,
    generatedAt: '2026-05-30T02:00:00.000Z',
    includeContext: false,
    runs: new Map([
      ['run_legacy', { id: 'run_legacy', completed_at: '2026-05-30T01:10:00.000Z' }],
    ]),
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
  });

  assert.equal(response.timeline_events.length, 1);
  assert.equal(response.timeline_events[0]?.event_type, 'legacy_section_item');
  assert.equal(response.timeline_events[0]?.title, 'Risk updated: Funding stress increased.');
  assert.equal(response.timeline_events[0]?.stable_item_key, null);
  assert.equal(response.timeline_events[0]?.diff_quality, 'partial');
  assert.equal(response.lifecycle_items.length, 0);
});

test('continuity timeline maps terminal statuses and returns stable empty ledgers', () => {
  const response = buildContinuityTimeline({
    entries: [
      entry('entry_statuses', 'run_statuses', '2026-05-30T01:00:00.000Z', [
        {
          event_type: 'claim_weakened',
          item_key: 'claim_macro',
          from: {
            type: 'claim',
            item_key: 'claim_macro',
            text: 'Macro liquidity supports upside.',
          },
          reason: 'Macro liquidity support weakened.',
        },
        {
          event_type: 'watchpoint_resolved',
          item_key: 'watch_funding',
          from: {
            type: 'watchpoint',
            item_key: 'watch_funding',
            text: 'Track funding reset.',
          },
          reason: 'Funding reset completed.',
        },
        {
          event_type: 'level_invalidated',
          item_key: 'level_50k',
          from: {
            type: 'level',
            item_key: 'level_50k',
            text: '50k support.',
          },
          reason: '50k support failed.',
        },
        {
          event_type: 'invalidation_updated',
          item_key: 'invalidation_breakdown',
          to: {
            type: 'invalidation',
            item_key: 'invalidation_breakdown',
            text: 'Breakdown below 48k invalidates the long thesis.',
          },
        },
        {
          event_type: 'view_changed',
          item_key: 'view_daily',
          to: {
            type: 'view',
            item_key: 'view_daily',
            text: 'Daily view shifted neutral.',
          },
        },
      ]),
    ],
    entryLimit: 50,
    fetchedEntryCount: 1,
    generatedAt: '2026-05-30T02:00:00.000Z',
    includeContext: false,
    runs: new Map([
      ['run_statuses', { id: 'run_statuses', completed_at: '2026-05-30T01:10:00.000Z' }],
    ]),
    symbol: 'BTC/USDT',
    workspaceId: 'workspace_a',
  });
  const statusesByKey = new Map(
    response.timeline_events.map((event) => [
      event.stable_item_key,
      event.status,
    ]),
  );

  assert.equal(statusesByKey.get('claim_macro'), 'weakened');
  assert.equal(statusesByKey.get('watch_funding'), 'resolved');
  assert.equal(statusesByKey.get('level_50k'), 'invalidated');
  assert.equal(statusesByKey.get('invalidation_breakdown'), 'invalidated');
  assert.equal(statusesByKey.get('view_daily'), 'updated');

  const empty = buildContinuityTimeline({
    entries: [],
    entryLimit: 50,
    fetchedEntryCount: 0,
    generatedAt: '2026-05-30T02:00:00.000Z',
    symbol: 'ETH/USDT',
    workspaceId: 'workspace_a',
  });

  assert.equal(empty.entry_count, 0);
  assert.equal(empty.event_count, 0);
  assert.deepEqual(empty.lifecycle_items, []);
  assert.deepEqual(empty.timeline_events, []);
  assert.deepEqual(empty.warnings, []);
  assert.equal(empty.window.coverage, 'complete');
});

function entry(
  id: string,
  runId: string,
  generatedAt: string,
  events: JsonRecord[],
  overrides: JsonRecord = {},
): JsonRecord {
  return {
    id,
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    research_run_id: runId,
    current_snapshot_id: `snapshot_${id}`,
    previous_entry_id: null,
    entry_type: 'delta',
    status: 'completed',
    generated_at: generatedAt,
    summary: `${id} summary`,
    sections: [],
    events,
    snapshot_quality: overrides.snapshot_quality ?? { status: 'clean', score: 1 },
    source_run_ids: [runId],
    writer_metadata: {},
    payload: {
      schema_version: 'research_continuity_entry.v1.1',
      ...(overrides.repair ? { repair: overrides.repair } : {}),
    },
  };
}
