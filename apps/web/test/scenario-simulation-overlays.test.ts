import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimulationOverlays } from '../src/components/scenarios/scenario-simulation-overlays.ts';
import type {
  ExecutionEventResponse,
  SimulationDetailResponse,
} from '../src/types/index.ts';

test('buildSimulationOverlays renders frozen paper playbook levels and execution markers', () => {
  const overlays = buildSimulationOverlays(
    simulationFixture({
      setup_expiry_at: '2026-07-04T01:00:00.000Z',
      events: [
        eventFixture({
          id: 'event_target_hit',
          event_type: 'target_hit',
          target_index: 0,
          market_time: '2026-07-04T00:20:00.000Z',
          price: '620',
          reason_code: 'target',
        }),
        eventFixture({
          id: 'event_partial',
          event_type: 'position_partially_closed',
          target_index: 0,
          market_time: '2026-07-04T00:20:00.000Z',
          price: '620',
          reason_code: 'target',
        }),
        eventFixture({
          id: 'event_invalidation',
          event_type: 'invalidation_hit',
          market_time: '2026-07-04T00:40:00.000Z',
          price: '540',
          reason_code: 'thesis_invalidation',
        }),
        eventFixture({
          id: 'event_failed',
          event_type: 'simulation_failed',
          market_time: '2026-07-04T00:45:00.000Z',
          reason_code: 'market_data_error',
        }),
      ],
    }),
  );

  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'invalidation' &&
      overlay.label === 'Paper stop' &&
      overlay.price === 540 &&
      overlay.status === 'failed'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'target' &&
      overlay.label === 'Paper Target 1' &&
      overlay.price === 620 &&
      overlay.status === 'passed'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'entry' &&
      overlay.label === 'Paper entry' &&
      overlay.price === 580),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'entry' &&
      overlay.label === 'Paper avg entry' &&
      overlay.price === 580),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'event_marker' &&
      overlay.id === 'simulation_run_1-setup-expiry' &&
      overlay.label === 'Setup expiry' &&
      overlay.time === '2026-07-04T01:00:00.000Z'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'event_marker' &&
      overlay.id === 'event_partial' &&
      overlay.label === 'Partial close: target 1' &&
      overlay.status === 'passed'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'event_marker' &&
      overlay.id === 'event_invalidation' &&
      overlay.label === 'Invalidation hit' &&
      overlay.status === 'failed'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'event_marker' &&
      overlay.id === 'event_failed' &&
      overlay.label === 'Simulation failed' &&
      overlay.status === 'failed'),
    true,
  );
});

test('buildSimulationOverlays renders frozen entry zones before fill and separates thesis invalidation', () => {
  const base = simulationFixture({});
  const overlays = buildSimulationOverlays({
    ...base,
    status: 'waiting_for_trigger',
    position: null,
    assumptions: {
      version: 'simulation_assumptions.v1',
      risk_exit: {
        type: 'hard_stop',
        level: '620',
        condition: null,
      },
      thesis_invalidation: {
        level: '540',
        condition: null,
      },
    },
    playbook_snapshot: {
      ...base.playbook_snapshot,
      direction: 'short',
      entry: {
        type: 'zone',
        condition: 'Retest supply',
        level: null,
        zone_low: 578,
        zone_high: 582,
      },
    },
  });

  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'price_zone' &&
      overlay.role === 'entry' &&
      overlay.label === 'Paper entry zone' &&
      overlay.price_low === 578 &&
      overlay.price_high === 582 &&
      overlay.status === 'active'),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'invalidation' &&
      overlay.label === 'Paper stop' &&
      overlay.price === 620),
    true,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'horizontal_line' &&
      overlay.role === 'invalidation' &&
      overlay.label === 'Thesis invalidation' &&
      overlay.price === 540),
    true,
  );
  assert.equal(
    overlays.some((overlay) => overlay.label === 'Paper avg entry'),
    false,
  );
});

test('buildSimulationOverlays uses setup-expired event instead of a duplicate expiry marker', () => {
  const overlays = buildSimulationOverlays(
    simulationFixture({
      setup_expiry_at: '2026-07-04T01:00:00.000Z',
      events: [
        eventFixture({
          id: 'event_setup_expired',
          event_type: 'setup_expired',
          market_time: '2026-07-04T01:00:00.000Z',
          price: '575',
          reason_code: 'entry_missed',
        }),
      ],
    }),
  );

  assert.equal(
    overlays.some((overlay) => overlay.id === 'simulation_run_1-setup-expiry'),
    false,
  );
  assert.equal(
    overlays.some((overlay) =>
      overlay.type === 'event_marker' &&
      overlay.id === 'event_setup_expired' &&
      overlay.label === 'Setup expired' &&
      overlay.status === 'blocked'),
    true,
  );
});

function simulationFixture(
  overrides: Partial<SimulationDetailResponse>,
): SimulationDetailResponse {
  return {
    version: 'simulation_run.v1',
    id: 'simulation_run_1',
    workspace_id: 'workspace_1',
    source_scenario_id: 'scenario_1',
    source_thesis_id: 'thesis_1',
    source_playbook_id: 'playbook_1',
    symbol: 'ETH',
    market_type: 'spot',
    mode: 'replay',
    sample_kind: 'out_of_sample_replay',
    status: 'position_open',
    status_reason: null,
    aggregate_version: 1,
    started_at: '2026-07-04T00:00:00.000Z',
    completed_at: null,
    cancelled_at: null,
    failure_reason: null,
    market_time: '2026-07-04T00:00:00.000Z',
    last_processed_candle_id: null,
    assumptions_hash: 'hash',
    setup_expiry_at: null,
    position_max_duration_minutes: null,
    evaluation_window: {},
    playbook_snapshot: {
      version: 'trade_playbook.v1',
      id: 'playbook_1',
      workspace_id: 'workspace_1',
      source_scenario_id: 'scenario_1',
      source_thesis_id: 'thesis_1',
      symbol: 'ETH',
      market_type: 'spot',
      direction: 'long',
      horizon: 'short',
      entry: {
        type: 'level',
        condition: 'Entry',
        level: 580,
        zone_low: null,
        zone_high: null,
      },
      invalidation: {
        condition: 'Stop',
        level: 540,
      },
      targets: [
        {
          label: 'Target 1',
          level: 620,
          rationale: 'First target',
        },
      ],
      no_trade_conditions: [],
      risk_context: [],
      sizing_policy: {
        mode: 'manual_context_only',
        notes: [],
      },
      evidence_refs: [],
      reliability_context: null,
      compile_warnings: [],
      compiler_version: 'playbook_compiler.v2',
      source_hashes: {
        scenario: 'scenario_hash',
        decision_playbook: 'decision_hash',
        recommendation: 'recommendation_hash',
        runtime_decision: 'runtime_hash',
      },
      status: 'current',
      stale_reasons: [],
      created_at: '2026-07-04T00:00:00.000Z',
    },
    analysis_snapshot: {},
    assumptions: {},
    market_data_snapshot: {},
    sample_identity: {},
    source_integrity_status: 'verified',
    source_drift_after_start: false,
    source_hashes: {},
    orders: [],
    position: {
      version: 'paper_position.v1',
      id: 'position_1',
      workspace_id: 'workspace_1',
      simulation_run_id: 'simulation_run_1',
      source_playbook_id: 'playbook_1',
      symbol: 'ETH',
      market_type: 'spot',
      direction: 'long',
      status: 'open',
      quantity_opened: '1',
      quantity_remaining: '1',
      average_entry_price: '580',
      realized_pnl: null,
      unrealized_pnl: null,
      realized_pnl_pct: null,
      unrealized_pnl_pct: null,
      opened_at_market_time: '2026-07-04T00:00:00.000Z',
      closed_at_market_time: null,
      close_reason: null,
    },
    outcome: null,
    events: [],
    ...overrides,
  };
}

function eventFixture(
  overrides: Partial<ExecutionEventResponse>,
): ExecutionEventResponse {
  return {
    version: 'execution_event.v1',
    id: 'event_1',
    workspace_id: 'workspace_1',
    simulation_run_id: 'simulation_run_1',
    source_playbook_id: 'playbook_1',
    source_scenario_id: 'scenario_1',
    event_type: 'position_opened',
    sequence: 1,
    aggregate_version: 1,
    correlation_id: 'correlation_1',
    causation_event_id: null,
    idempotency_key: 'idempotency_1',
    order_id: null,
    position_id: 'position_1',
    target_index: null,
    occurrence_index: 1,
    market_time: '2026-07-04T00:00:00.000Z',
    recorded_at: '2026-07-04T00:00:00.000Z',
    price: null,
    quantity: null,
    reason_code: 'position_opened',
    source_candle_id: null,
    payload: {},
    ...overrides,
  };
}
