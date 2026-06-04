import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterLifecycleTimelineEvents,
  lifecycleStatusFilterOptions,
  lifecycleStatusCounts,
  selectedLifecycleTimelineEvents,
  windowedLifecycleLabel,
} from '../src/pages/research-continuity-lifecycle.ts';

test('research continuity lifecycle helpers count filter select and label timeline state', () => {
  const timeline = {
    window: {
      entry_limit: 2,
      truncated: true,
      coverage: 'windowed',
    },
    lifecycle_items: [
      {
        stable_item_key: 'risk_1',
        status: 'active',
        timeline_event_ids: ['event_1', 'event_2'],
      },
      {
        stable_item_key: 'claim_1',
        status: 'weakened',
        timeline_event_ids: ['event_3'],
      },
      {
        stable_item_key: 'watch_1',
        status: 'resolved',
        timeline_event_ids: ['event_4'],
      },
      {
        stable_item_key: 'scenario_1',
        status: 'updated',
        timeline_event_ids: ['event_5'],
      },
    ],
    timeline_events: [
      {
        id: 'event_1',
        stable_item_key: 'risk_1',
        item_type: 'risk',
        status: 'active',
      },
      {
        id: 'event_2',
        stable_item_key: 'risk_1',
        item_type: 'risk',
        status: 'updated',
      },
      {
        id: 'event_3',
        stable_item_key: 'claim_1',
        item_type: 'claim',
        status: 'weakened',
      },
      {
        id: 'event_4',
        stable_item_key: 'watch_1',
        item_type: 'watchpoint',
        status: 'resolved',
      },
      {
        id: 'event_5',
        stable_item_key: 'scenario_1',
        item_type: 'scenario',
        status: 'updated',
      },
    ],
  };

  assert.deepEqual(lifecycleStatusCounts(timeline), {
    active: 1,
    updated: 1,
    resolved: 1,
    weakened: 1,
    invalidated: 0,
  });
  assert.deepEqual(
    filterLifecycleTimelineEvents(timeline.timeline_events, {
      itemType: 'risk',
      status: 'active',
    }).map((event) => event.id),
    ['event_1'],
  );
  assert.deepEqual(
    filterLifecycleTimelineEvents(timeline.timeline_events, {
      itemType: 'scenario',
      status: 'updated',
    }).map((event) => event.id),
    ['event_5'],
  );
  assert.deepEqual(
    selectedLifecycleTimelineEvents(timeline, 'risk_1').map((event) => event.id),
    ['event_1', 'event_2'],
  );
  assert.equal(
    selectedLifecycleTimelineEvents(timeline, null).map((event) => event.id)[0],
    'event_1',
  );
  assert.equal(
    windowedLifecycleLabel(timeline),
    'Windowed to the latest 2 entries; first-seen values and counts are scoped to this window.',
  );
  assert.deepEqual(lifecycleStatusFilterOptions().map((option) => option.value), [
    'all',
    'active',
    'updated',
    'resolved',
    'weakened',
    'invalidated',
  ]);
});
