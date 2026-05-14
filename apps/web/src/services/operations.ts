import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  DataFreshnessResponse,
  LlmCallResponse,
  OperationsHealthResponse,
  ProviderHealthResponse,
} from '@/types';

export function getOperationsHealth(
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<OperationsHealthResponse>(
    '/operations/health',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function listProviderHealth(params: { limit?: number }, auth: WorkspaceRequestContext) {
  return apiRequest<ProviderHealthResponse[]>(
    '/operations/provider-health',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function listLlmCalls(params: { limit?: number }, auth: WorkspaceRequestContext) {
  return apiRequest<LlmCallResponse[]>(
    '/operations/llm-calls',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function listDataFreshness(
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<DataFreshnessResponse[]>(
    '/operations/data-freshness',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}
