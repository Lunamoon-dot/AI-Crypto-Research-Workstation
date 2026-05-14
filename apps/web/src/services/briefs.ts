import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import { BriefResponse, CreateDailyBriefRequest } from '@/types';

export function listDailyBriefs(
  params: {
    date?: string;
    limit?: number;
    watchlist_id?: string;
    watchlist_name?: string;
  },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<BriefResponse[]>(
    '/briefs/daily',
    {
      query: {
        date: params.date,
        limit: params.limit ?? 20,
        watchlist_id: params.watchlist_id,
        watchlist_name: params.watchlist_name,
      },
    },
    auth,
  );
}

export function createDailyBrief(
  request: CreateDailyBriefRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<BriefResponse>(
    '/briefs/daily',
    { method: 'POST', body: request },
    auth,
  );
}
