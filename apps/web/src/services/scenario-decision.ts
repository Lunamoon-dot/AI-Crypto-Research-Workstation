import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type { PlaybookCompileReportResponse } from '@/types';

export function compileScenarioDecisionPlaybook(
  scenarioId: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PlaybookCompileReportResponse>(
    `/scenarios/${encodeURIComponent(scenarioId)}/playbook`,
    { method: 'POST', body: {} },
    auth,
  );
}
