import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import { SignalResponse } from '@/types';

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
