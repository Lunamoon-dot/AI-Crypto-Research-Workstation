import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import {
  CreateResearchRunRequest,
  JobStatusResponse,
  JournalRunWorkspaceResponse,
  ResearchRunResponse,
  ResearchRunQueuedResponse,
} from '@/api/types';

export function listResearchRuns(
  params: { symbol?: string; status?: string; limit?: number },
  auth: AuthContextValue,
) {
  return apiRequest<ResearchRunResponse[]>(
    '/research-runs',
    {
      query: {
        symbol: params.symbol,
        status: params.status,
        limit: params.limit ?? 50,
      },
    },
    auth,
  );
}

export function createResearchRun(
  request: CreateResearchRunRequest,
  auth: AuthContextValue,
) {
  return apiRequest<ResearchRunQueuedResponse>(
    '/research-runs',
    { method: 'POST', body: request },
    auth,
  );
}

export function getResearchRunWorkspace(id: string, auth: AuthContextValue) {
  return apiRequest<JournalRunWorkspaceResponse>(
    `/research-runs/${encodeURIComponent(id)}/workspace`,
    {},
    auth,
  );
}

export function getJournalRunWorkspace(id: string, auth: AuthContextValue) {
  return apiRequest<JournalRunWorkspaceResponse>(
    `/journal/runs/${encodeURIComponent(id)}/workspace`,
    {},
    auth,
  );
}

export function getJobStatus(id: string, auth: AuthContextValue) {
  return apiRequest<JobStatusResponse>(
    `/jobs/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}
