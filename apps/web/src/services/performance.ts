import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  PerformanceAnalyticsResponse,
  PerformanceHealthResponse,
  PerformanceOutcomeReviewResponse,
  PerformanceTrendPointResponse,
} from '@/types';

export function listPerformanceOutcomes(
  params: { symbol?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PerformanceOutcomeReviewResponse[]>(
    '/performance/outcomes',
    { query: { symbol: params.symbol, limit: params.limit ?? 100 } },
    auth,
  );
}

export function getPerformanceAnalytics(
  params: { symbol?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PerformanceAnalyticsResponse>(
    '/performance/analytics',
    { query: { symbol: params.symbol, limit: params.limit ?? 200 } },
    auth,
  );
}

export function getPerformanceTrend(
  params: { days?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PerformanceTrendPointResponse[]>(
    '/performance/trend',
    { query: { days: params.days ?? 90 } },
    auth,
  );
}

export function getPerformanceHealth(
  params: { recent_days?: number; baseline_days?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PerformanceHealthResponse>(
    '/performance/health',
    {
      query: {
        recent_days: params.recent_days ?? 14,
        baseline_days: params.baseline_days ?? 60,
      },
    },
    auth,
  );
}
