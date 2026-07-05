import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  PlaybookCompileReportResponse,
  ScenarioDecisionQueueItemResponse,
  ScenarioDecisionWorkbenchResponse,
} from '@/types';

export function getScenarioDecisionWorkbench(auth: WorkspaceRequestContext) {
  return apiRequest<ScenarioDecisionWorkbenchResponse>(
    '/scenario-decision/workbench',
    {},
    auth,
  );
}

export function resolveScenarioDecisionItem(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioDecisionQueueItemResponse>(
    `/scenario-decision/items/${encodeURIComponent(id)}/resolve`,
    { method: 'POST', body: {} },
    auth,
  );
}

export function snoozeScenarioDecisionItem(
  id: string,
  dueAt: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ScenarioDecisionQueueItemResponse>(
    `/scenario-decision/items/${encodeURIComponent(id)}/snooze`,
    { method: 'POST', body: { due_at: dueAt } },
    auth,
  );
}

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
