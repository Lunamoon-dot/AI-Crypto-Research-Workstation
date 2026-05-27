import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  createApiClient,
} from '@/services/generated/api-client';
import type {
  GenerateResearchContinuityRequest,
  GenerateResearchContinuityResponse,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityStateEnvelopeResponse,
} from '@/types';

export function getResearchRunContinuity(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchRunContinuity(id);
}

export function generateResearchRunContinuity(
  id: string,
  request: GenerateResearchContinuityRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).generateResearchRunContinuity(id, request);
}

export function getResearchContinuityState(
  symbol: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityState(symbol);
}

export function listResearchContinuityEntries(
  symbol: string,
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).listResearchContinuityEntries(symbol, params);
}

function generatedClient(auth: WorkspaceRequestContext) {
  return createApiClient((path, options) =>
    apiRequest(path, options, auth),
  );
}

export type {
  GenerateResearchContinuityRequest,
  GenerateResearchContinuityResponse,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityStateEnvelopeResponse,
};
