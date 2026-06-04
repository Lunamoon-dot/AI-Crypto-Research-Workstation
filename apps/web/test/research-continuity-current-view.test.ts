import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildActiveScenarioBranchViews,
  buildCapturedContinuityMemoryGroups,
  buildContinuitySnapshotView,
} from '../src/pages/research-continuity-current-view.ts';

test('continuity snapshot falls back to latest entry current view when state is missing', () => {
  const snapshot = buildContinuitySnapshotView({
    latestEntry: {
      id: 'entry_1',
      research_run_id: 'run_1',
      status: 'degraded',
      generated_at: '2026-05-31T06:20:06.541Z',
      diff_summary: {
        added_count: 31,
      },
      thin_report: {
        sections: [
          {
            id: 'current_view',
            title: 'Current View',
            items: [
              'Directional bias: bearish (draft; low-confidence snapshot).',
              'Risk posture: defensive.',
              'Conviction: low.',
              'Time context: dailycontext.',
            ],
          },
        ],
      },
    },
    state: null,
  });

  assert.equal(snapshot?.directionalBias, 'bearish (draft; low-confidence snapshot)');
  assert.equal(snapshot?.riskPosture, 'defensive');
  assert.equal(snapshot?.conviction, 'low');
  assert.equal(snapshot?.timeContext, 'dailycontext');
  assert.equal(snapshot?.latestRunId, 'run_1');
  assert.equal(snapshot?.latestEntryId, 'entry_1');
  assert.equal(snapshot?.activeItemCount, 0);
  assert.equal(snapshot?.capturedItemCount, 31);
  assert.equal(snapshot?.memoryLabel, '31 captured');
  assert.equal(snapshot?.memoryKind, 'captured');
  assert.equal(snapshot?.updatedAt, '2026-05-31T06:20:06.541Z');
});

test('continuity snapshot prefers projected state values over latest entry fallback', () => {
  const snapshot = buildContinuitySnapshotView({
    latestEntry: {
      id: 'entry_1',
      research_run_id: 'run_1',
      status: 'degraded',
      generated_at: '2026-05-31T06:20:06.541Z',
      diff_summary: {
        added_count: 31,
      },
      thin_report: {
        sections: [
          {
            id: 'current_view',
            title: 'Current View',
            items: ['Directional bias: bearish.'],
          },
        ],
      },
    },
    state: {
      latest_run_id: 'run_state',
      latest_entry_id: 'entry_state',
      current_view: {
        directional_bias: 'neutral',
        risk_posture: 'balanced',
        conviction: 'medium',
        time_context: 'daily_context',
      },
      active_items: [{ item_key: 'risk_1' }],
      active_scenarios: [],
      updated_at: '2026-05-31T07:00:00.000Z',
    },
  });

  assert.equal(snapshot?.directionalBias, 'neutral');
  assert.equal(snapshot?.riskPosture, 'balanced');
  assert.equal(snapshot?.conviction, 'medium');
  assert.equal(snapshot?.timeContext, 'daily_context');
  assert.equal(snapshot?.latestRunId, 'run_state');
  assert.equal(snapshot?.latestEntryId, 'entry_state');
  assert.equal(snapshot?.activeItemCount, 1);
  assert.equal(snapshot?.capturedItemCount, 0);
  assert.equal(snapshot?.memoryLabel, '1 active');
  assert.equal(snapshot?.memoryKind, 'active');
  assert.equal(snapshot?.updatedAt, '2026-05-31T07:00:00.000Z');
});

test('continuity snapshot counts active scenario branches as active memory', () => {
  const state = {
    latest_run_id: 'run_state',
    latest_entry_id: 'entry_state',
    current_view: {},
    active_items: [],
    active_scenarios: [
      {
        scenario_key: 'thesis_1:confirmation:if-btc-reclaims-108k-on-acceptance',
        branch_type: 'confirmation',
        probability_band: 'high',
        condition: 'If BTC reclaims 108k on acceptance',
        occurrence_count: 2,
      },
    ],
    updated_at: '2026-05-31T07:00:00.000Z',
  };
  const snapshot = buildContinuitySnapshotView({
    latestEntry: null,
    state,
  });

  assert.equal(snapshot?.activeItemCount, 0);
  assert.equal(snapshot?.activeScenarioCount, 1);
  assert.equal(snapshot?.memoryKind, 'active');
  assert.equal(snapshot?.memoryLabel, '1 active');
  assert.deepEqual(buildActiveScenarioBranchViews(state), [
    {
      key: 'thesis_1:confirmation:if-btc-reclaims-108k-on-acceptance',
      branchType: 'confirmation',
      probabilityBand: 'high',
      condition: 'If BTC reclaims 108k on acceptance',
      occurrenceCount: 2,
    },
  ]);
});

test('captured continuity memory groups expose latest degraded entry items', () => {
  const groups = buildCapturedContinuityMemoryGroups({
    thin_report: {
      sections: [
        {
          id: 'quality',
          title: 'Data Quality',
          items: ['Snapshot degraded.'],
        },
        {
          id: 'active_risks',
          title: 'Active Risks',
          items: ['Risk item 1.', 'Risk item 2.'],
        },
        {
          id: 'watchpoints',
          title: 'Watchpoints',
          items: ['Watchpoint item.'],
        },
        {
          id: 'material_changes',
          title: 'Material Changes',
          items: ['Material change item.'],
        },
      ],
    },
  });

  assert.deepEqual(
    groups.map((group) => ({
      id: group.id,
      items: group.items,
      title: group.title,
    })),
    [
      {
        id: 'active_risks',
        items: ['Risk item 1.', 'Risk item 2.'],
        title: 'Active Risks',
      },
      {
        id: 'watchpoints',
        items: ['Watchpoint item.'],
        title: 'Watchpoints',
      },
      {
        id: 'material_changes',
        items: ['Material change item.'],
        title: 'Material Changes',
      },
    ],
  );
});
