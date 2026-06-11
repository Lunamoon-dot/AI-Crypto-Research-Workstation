import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  createApiClient,
} from '@/services/generated/api-client';
import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceNewsSourcesRequest,
  WorkspaceNewsSourcesResponse,
  WorkspaceSummary,
} from '@/types';

export function listWorkspaces(auth: WorkspaceRequestContext) {
  return generatedClient(auth).listWorkspaces();
}

export function createWorkspace(
  request: CreateWorkspaceRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).createWorkspace(request);
}

export function getWorkspace(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).getWorkspace(id);
}

export function deleteWorkspace(id: string, auth: WorkspaceRequestContext) {
  return generatedClient(auth).deleteWorkspace(id);
}

export function listWorkspaceNewsSources(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WorkspaceNewsSourcesResponse>(
    `/workspaces/${encodeURIComponent(id)}/news-sources`,
    {},
    auth,
  );
}

export function updateWorkspaceNewsSources(
  id: string,
  request: UpdateWorkspaceNewsSourcesRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<WorkspaceNewsSourcesResponse>(
    `/workspaces/${encodeURIComponent(id)}/news-sources`,
    { method: 'PUT', body: request },
    auth,
  );
}

function generatedClient(auth: WorkspaceRequestContext) {
  return createApiClient((path, options) =>
    apiRequest(path, options, auth),
  );
}

export type {
  CreateWorkspaceRequest,
  UpdateWorkspaceNewsSourcesRequest,
  WorkspaceNewsSourcesResponse,
  WorkspaceSummary,
};
