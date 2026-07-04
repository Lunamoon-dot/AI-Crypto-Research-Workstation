import type { SimulationRunResponse } from '@/types';

const ACTIVE_FORWARD_STATUSES = new Set<SimulationRunResponse['status']>([
  'created',
  'waiting_for_trigger',
  'entry_triggered',
  'order_pending',
  'position_open',
]);

export function activeForwardRun(
  runs: SimulationRunResponse[],
): SimulationRunResponse | null {
  return latestSimulationRun(
    runs,
    (run) => run.mode === 'forward' && ACTIVE_FORWARD_STATUSES.has(run.status),
  );
}

export function latestCompletedForwardRun(
  runs: SimulationRunResponse[],
): SimulationRunResponse | null {
  return latestSimulationRun(
    runs,
    (run) => run.mode === 'forward' && run.status === 'completed',
  );
}

export function latestReplayRun(
  runs: SimulationRunResponse[],
): SimulationRunResponse | null {
  return latestSimulationRun(runs, (run) => run.mode === 'replay');
}

export function replayHistoryRuns(
  runs: SimulationRunResponse[],
): SimulationRunResponse[] {
  return runs
    .filter((run) => run.mode === 'replay')
    .slice()
    .sort(sortSimulationRunsByRecency);
}

function latestSimulationRun(
  runs: SimulationRunResponse[],
  predicate: (run: SimulationRunResponse) => boolean,
): SimulationRunResponse | null {
  return runs
    .filter(predicate)
    .slice()
    .sort(sortSimulationRunsByRecency)[0] ?? null;
}

function sortSimulationRunsByRecency(
  left: SimulationRunResponse,
  right: SimulationRunResponse,
): number {
  const timeDelta = runRecencyTimestamp(right) - runRecencyTimestamp(left);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return right.id.localeCompare(left.id);
}

function runRecencyTimestamp(run: SimulationRunResponse): number {
  const timestamp = Date.parse(
    run.completed_at ?? run.cancelled_at ?? run.market_time ?? run.started_at,
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}
