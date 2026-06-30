import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  BacktestAssumptionSetResponse,
  BacktestRunResponse,
  PlaybookCompileReportResponse,
  ScenarioDecisionQueueItemResponse,
  ScenarioDecisionWorkbenchResponse,
  ScenarioEvaluationResponse,
} from '@/types';

export function getScenarioDecisionWorkbench(auth: WorkspaceRequestContext) {
  return apiRequest<ScenarioDecisionWorkbenchResponse>(
    '/scenario-decision/workbench',
    {},
    auth,
  );
}

export function resolveScenarioDecisionItem(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioDecisionQueueItemResponse>(
    `/scenario-decision/items/${encodeURIComponent(id)}/resolve`,
    { method: 'POST', body: {} },
    auth,
  );
}

export function snoozeScenarioDecisionItem(
  id: string,
  dueAt: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioDecisionQueueItemResponse>(
    `/scenario-decision/items/${encodeURIComponent(id)}/snooze`,
    { method: 'POST', body: { due_at: dueAt } },
    auth,
  );
}

export function evaluateScenarioDecisionItem(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioEvaluationResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/evaluations`,
    { method: 'POST', body: {} },
    auth,
  );
}

export function compileScenarioDecisionPlaybook(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PlaybookCompileReportResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/playbook`,
    { method: 'POST', body: {} },
    auth,
  );
}

export function createScenarioDecisionBacktest(
  playbookId: string,
  auth: WorkspaceRequestContext,
  assumptions: BacktestAssumptionSetResponse = defaultBacktestAssumptions(),
) {
  return apiRequest<BacktestRunResponse>(
    `/playbooks/${encodeURIComponent(playbookId)}/backtests`,
    { method: 'POST', body: assumptions },
    auth,
  );
}

function defaultBacktestAssumptions(): BacktestAssumptionSetResponse {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  return {
    version: 'backtest_assumption_set.v1',
    fee_bps: 5,
    slippage_bps: 5,
    fill_policy: 'touch',
    sizing_policy: 'fixed_notional',
    starting_equity: 10_000,
    risk_fraction: null,
    timeframe: '1d',
    start_at: start.toISOString(),
    end_at: end.toISOString(),
  };
}
