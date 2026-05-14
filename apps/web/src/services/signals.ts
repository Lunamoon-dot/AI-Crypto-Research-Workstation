import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import { SignalCountResponse, SignalDetailResponse, SignalResponse } from '@/types';

export function listSignals(
  params: { symbol?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SignalResponse[]>(
    '/signals',
    { query: { symbol: params.symbol, limit: params.limit ?? 50 } },
    auth,
  );
}

export function countSignals(
  params: { symbol?: string },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SignalCountResponse>(
    '/signals/count',
    { query: { symbol: params.symbol } },
    auth,
  );
}

export function getSignal(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<SignalDetailResponse>(
    `/signals/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}
