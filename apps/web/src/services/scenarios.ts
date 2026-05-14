import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type { ScenarioMonitorResponse } from '@/types';

export function getScenarioMonitor(
  params: { symbol?: string; status?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioMonitorResponse>(
    '/scenarios/monitor',
    {
      query: {
        symbol: params.symbol,
        status: params.status,
        limit: params.limit ?? 100,
      },
    },
    auth,
  );
}
