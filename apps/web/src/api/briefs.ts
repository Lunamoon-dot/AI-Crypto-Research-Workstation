import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import { BriefResponse } from '@/api/types';

export function listDailyBriefs(
  params: { date?: string; limit?: number },
  auth: AuthContextValue,
) {
  return apiRequest<BriefResponse[]>(
    '/briefs/daily',
    { query: { date: params.date, limit: params.limit ?? 20 } },
    auth,
  );
}
