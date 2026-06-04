import assert from 'node:assert/strict';
import test from 'node:test';
import { ContinuityStateProjector } from '../src/research-continuity/continuity-state.projector';

test('continuity state projector starts newly added scenarios at the current run', () => {
  const projector = new ContinuityStateProjector();
  const state = projector.project(
    {
      id: 'state_btc',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      latest_run_id: 'run_previous',
      updated_at: '2026-05-30T01:00:00.000Z',
      active_scenarios: [
        {
          scenario_key: 'scenario:existing',
          first_seen_at: '2026-05-30T00:00:00.000Z',
          first_seen_run_id: 'run_existing',
          occurrence_count: 1,
        },
      ],
    },
    {
      id: 'snapshot_current',
      research_run_id: 'run_current',
      captured_at: '2026-05-30T02:00:00.000Z',
      symbol_view: {},
      data_quality: { status: 'clean', score: 1 },
      tracked_items: [],
      scenario_branches: [
        {
          scenario_key: 'scenario:new',
          scenario_id: 'new',
          condition: 'If BTC accepts above resistance.',
          probability_band: 'watch',
        },
      ],
    },
    {
      id: 'entry_current',
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      research_run_id: 'run_current',
      entry_type: 'delta',
      status: 'completed',
      generated_at: '2026-05-30T02:05:00.000Z',
    },
    [
      {
        event_type: 'scenario_added',
        item_key: 'scenario:new',
        from: null,
        to: {
          scenario_key: 'scenario:new',
          scenario_id: 'new',
        },
      },
    ],
  );

  const activeScenarios = Array.isArray(state?.active_scenarios)
    ? state.active_scenarios
    : [];
  const activeScenario = activeScenarios[0] as Record<string, unknown> | undefined;
  assert.equal(activeScenario?.first_seen_at, '2026-05-30T02:00:00.000Z');
  assert.equal(activeScenario?.first_seen_run_id, 'run_current');
  assert.equal(activeScenario?.occurrence_count, 1);
});
