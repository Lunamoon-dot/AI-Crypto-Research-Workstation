import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import { SignalResponse } from '@/api/types';

export function listSignals(
  params: { symbol?: string; limit?: number },
  auth: AuthContextValue,
) {
  return apiRequest<SignalResponse[]>(
    '/signals',
    { query: { symbol: params.symbol, limit: params.limit ?? 50 } },
    auth,
  );
}
