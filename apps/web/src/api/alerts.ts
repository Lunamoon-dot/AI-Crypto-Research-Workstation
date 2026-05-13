import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import { AlertResponse } from '@/api/types';

export function listAlerts(
  params: {
    symbol?: string;
    thesis_id?: string;
    unread?: boolean;
    limit?: number;
  },
  auth: AuthContextValue,
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

export function markAlertRead(id: string, auth: AuthContextValue) {
  return apiRequest<AlertResponse>(
    `/alerts/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
    auth,
  );
}
