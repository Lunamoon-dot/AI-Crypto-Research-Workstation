import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type { ComparisonResponse } from '@/types';

export function compareTheses(
  params: { left_id: string; right_id: string },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ComparisonResponse>(
    '/comparisons/theses',
    { query: params },
    auth,
  );
}

export function compareRuns(
  params: { left_id: string; right_id: string },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ComparisonResponse>(
    '/comparisons/runs',
    { query: params },
    auth,
  );
}
