import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeForwardRun,
  latestCompletedForwardRun,
  latestReplayRun,
  replayHistoryRuns,
} from '../src/components/scenarios/paper-simulation-read-model.ts';
import type { SimulationRunResponse } from '../src/types/index.ts';

test('paper simulation read model prioritizes the newest active forward run', () => {
  const selected = activeForwardRun([
    runFixture({
      id: 'forward_old',
      mode: 'forward',
      status: 'waiting_for_trigger',
      started_at: '2026-07-04T00:00:00.000Z',
    }),
    runFixture({
      id: 'forward_new',
      mode: 'forward',
      status: 'position_open',
      market_time: '2026-07-04T02:00:00.000Z',
    }),
    runFixture({
      id: 'replay_newer',
      mode: 'replay',
      status: 'completed',
      completed_at: '2026-07-04T03:00:00.000Z',
    }),
  ]);

  assert.equal(selected?.id, 'forward_new');
});

test('paper simulation read model separates completed forward from replay history', () => {
  const runs = [
    runFixture({
      id: 'replay_old',
      mode: 'replay',
      status: 'completed',
      completed_at: '2026-07-04T00:30:00.000Z',
    }),
    runFixture({
      id: 'forward_completed',
      mode: 'forward',
      status: 'completed',
      completed_at: '2026-07-04T01:00:00.000Z',
    }),
    runFixture({
      id: 'replay_new',
      mode: 'replay',
      status: 'completed',
      completed_at: '2026-07-04T02:00:00.000Z',
    }),
  ];

  assert.equal(latestCompletedForwardRun(runs)?.id, 'forward_completed');
  assert.equal(latestReplayRun(runs)?.id, 'replay_new');
  assert.deepEqual(replayHistoryRuns(runs).map((run) => run.id), [
    'replay_new',
    'replay_old',
  ]);
});

function runFixture(
  overrides: Partial<SimulationRunResponse>,
): SimulationRunResponse {
  return {
    version: 'simulation_run.v1',
    id: 'run_1',
    workspace_id: 'workspace_1',
    source_scenario_id: 'scenario_1',
    source_thesis_id: 'thesis_1',
    source_playbook_id: 'playbook_1',
    symbol: 'ETH',
    market_type: 'spot',
    mode: 'replay',
    sample_kind: 'manual_experiment',
    status: 'completed',
    status_reason: null,
    aggregate_version: 1,
    started_at: '2026-07-04T00:00:00.000Z',
    completed_at: null,
    cancelled_at: null,
    failure_reason: null,
    market_time: null,
    last_processed_candle_id: null,
    assumptions_hash: 'hash',
    setup_expiry_at: null,
    position_max_duration_minutes: null,
    evaluation_window: {},
    playbook_snapshot: {},
    analysis_snapshot: {},
    assumptions: {},
    market_data_snapshot: {},
    sample_identity: {},
    source_integrity_status: 'verified',
    source_drift_after_start: false,
    source_hashes: {},
    ...overrides,
  } as SimulationRunResponse;
}
