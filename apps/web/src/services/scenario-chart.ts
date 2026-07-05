import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  MarketChartInterval,
  ScenarioChartProjectionResponse,
  ScenarioChartSummaryResponse,
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
} from '@/types';

export function getScenarioLiveState(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioLiveStateResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/live`,
    {},
    auth,
  );
}

export function refreshScenarioLiveState(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioLiveStateResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/live/refresh`,
    { method: 'POST' },
    auth,
  );
}

export function listScenarioEvents(
  scenarioId: string,
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioEventResponse[]>(
    `/scenarios/${encodeURIComponent(scenarioId)}/events`,
    {
      query: {
        limit: params.limit ?? 50,
      },
    },
    auth,
  );
}

export function getScenarioChartProjection(
  scenarioId: string,
  params: {
    interval?: MarketChartInterval;
    limit?: number;
    simulationId?: string | null;
  },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioChartProjectionResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/chart`,
    {
      query: {
        interval: params.interval ?? '15m',
        limit: params.limit ?? 200,
        simulation_id: params.simulationId ?? undefined,
      },
    },
    auth,
  );
}

export function getScenarioChartSummary(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioChartSummaryResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/chart-summary`,
    {},
    auth,
  );
}

export function getScenarioChartSummaries(
  scenarioIds: string[],
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioChartSummaryResponse[]>(
    '/scenarios/chart-summaries',
    {
      method: 'POST',
      body: { scenario_ids: scenarioIds },
    },
    auth,
  );
}
