import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  createApiClient,
  CreateResearchRunRequest,
  JobStatusResponse,
  JournalRunWorkspaceResponse,
  ResearchRunResponse,
  ResearchRunQueuedResponse,
} from '@/services/generated/api-client';
import type { EvidenceBundleResponse } from '@/types';

export function listResearchRuns(
  params: { symbol?: string; status?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).listResearchRuns(params);
}

export function createResearchRun(
  request: CreateResearchRunRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).createResearchRun(request);
}

export function getResearchRunWorkspace(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).getResearchRunWorkspace(id);
}

export function getJournalRunWorkspace(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).getJournalRunWorkspace(id);
}

export function getResearchRunEvidenceBundle(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchRunEvidenceBundle(id);
}

export function getJournalRunEvidenceBundle(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getJournalRunEvidenceBundle(id);
}

export function getJobStatus(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).getJobStatus(id);
}

export function cancelJob(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).cancelJob(id);
}

function generatedClient(auth: WorkspaceRequestContext) {
  return createApiClient((path, options) =>
    apiRequest(path, options, auth),
  );
}

export type {
  CreateResearchRunRequest,
  EvidenceBundleResponse,
  JobStatusResponse,
  JournalRunWorkspaceResponse,
  ResearchRunResponse,
  ResearchRunQueuedResponse,
};
