import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  createApiClient,
} from '@/services/generated/api-client';
import type { CreateWorkspaceRequest, WorkspaceSummary } from '@/types';

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

function generatedClient(auth: WorkspaceRequestContext) {
  return createApiClient((path, options) =>
    apiRequest(path, options, auth),
  );
}

export type { CreateWorkspaceRequest, WorkspaceSummary };
