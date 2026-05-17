import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  PatchThesisMonitorPlanRequest,
  RunThesisPulseMemoRequest,
  RunThesisPulseMemoResponse,
  RunThesisPulseRequest,
  RunThesisPulseResponse,
  RunThesisSchedulerRequest,
  ThesisMonitorPlanResponse,
  ThesisPulseMemoResponse,
  ThesisPulseResponse,
  ThesisSchedulerRunResponse,
  ThesisSchedulerStatusResponse,
} from '@/types';

export function getThesisMonitorPlan(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisMonitorPlanResponse>(
    `/theses/${encodeURIComponent(id)}/monitor-plan`,
    {},
    auth,
  );
}

export function listThesisPulses(
  id: string,
  auth: WorkspaceRequestContext,
  params: { limit?: number } = {},
) {
  return apiRequest<ThesisPulseResponse[]>(
    `/theses/${encodeURIComponent(id)}/pulses`,
    { query: { limit: params.limit ?? 200 } },
    auth,
  );
}

export function runThesisPulse(
  id: string,
  request: RunThesisPulseRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<RunThesisPulseResponse>(
    `/theses/${encodeURIComponent(id)}/pulses/run`,
    { method: 'POST', body: request },
    auth,
  );
}

export function listThesisPulseMemos(
  id: string,
  auth: WorkspaceRequestContext,
  params: { limit?: number } = {},
) {
  return apiRequest<ThesisPulseMemoResponse[]>(
    `/theses/${encodeURIComponent(id)}/pulse-memos`,
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function runThesisPulseMemo(
  id: string,
  request: RunThesisPulseMemoRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<RunThesisPulseMemoResponse>(
    `/theses/${encodeURIComponent(id)}/pulse-memos/run`,
    { method: 'POST', body: request },
    auth,
  );
}

export function updateThesisMonitorPlan(
  id: string,
  request: PatchThesisMonitorPlanRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisMonitorPlanResponse>(
    `/theses/${encodeURIComponent(id)}/monitor-plan`,
    { method: 'PATCH', body: request },
    auth,
  );
}

export function getThesisSchedulerStatus(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisSchedulerStatusResponse>(
    `/theses/${encodeURIComponent(id)}/scheduler`,
    {},
    auth,
  );
}

export function resumeThesisScheduler(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisSchedulerStatusResponse>(
    `/theses/${encodeURIComponent(id)}/scheduler/resume`,
    { method: 'POST' },
    auth,
  );
}

export function pauseThesisScheduler(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisSchedulerStatusResponse>(
    `/theses/${encodeURIComponent(id)}/scheduler/pause`,
    { method: 'POST' },
    auth,
  );
}

export function runThesisSchedulerDue(
  id: string,
  request: RunThesisSchedulerRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisSchedulerRunResponse>(
    `/theses/${encodeURIComponent(id)}/scheduler/run-due`,
    { method: 'POST', body: request },
    auth,
  );
}
