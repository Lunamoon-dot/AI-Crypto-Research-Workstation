import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  AlertResponse,
  AlertSchedulerStatusResponse,
  WatchlistPollResponse,
} from '@/types';

export function listAlerts(
  params: {
    symbol?: string;
    thesis_id?: string;
    unread?: boolean;
    limit?: number;
  },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<AlertResponse[]>(
    '/alerts',
    {
      query: {
        symbol: params.symbol,
        thesis_id: params.thesis_id,
        unread: params.unread,
        limit: params.limit ?? 50,
      },
    },
    auth,
  );
}

export function markAlertRead(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<AlertResponse>(
    `/alerts/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
    auth,
  );
}

export function getAlertSchedulerStatus(auth: WorkspaceRequestContext) {
  return apiRequest<AlertSchedulerStatusResponse>(
    '/alerts/scheduler',
    {},
    auth,
  );
}

export function runAlertScheduler(auth: WorkspaceRequestContext) {
  return apiRequest<WatchlistPollResponse>(
    '/alerts/scheduler/run',
    { method: 'POST' },
    auth,
  );
}
