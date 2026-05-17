import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type { WorkbenchAttentionResponse } from '@/types';

export function getWorkbenchAttention(
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WorkbenchAttentionResponse>(
    '/workbench/attention',
    {
      query: {
        limit: params.limit ?? 10,
      },
    },
    auth,
  );
}
