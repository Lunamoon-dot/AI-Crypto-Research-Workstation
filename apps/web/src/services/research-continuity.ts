import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  createApiClient,
} from '@/services/generated/api-client';
import type {
  GenerateResearchContinuityRequest,
  GenerateResearchContinuityResponse,
  ResearchContinuityEntriesResponse,
  ResearchContinuityEntryDebugResponse,
  ResearchContinuityEntryDetailResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityRepairPreviewRequest,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunDetailResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunsResponse,
  ResearchContinuityRepairRunSummaryResponse,
  ResearchContinuitySchedulerRunDueResponse,
  ResearchContinuitySchedulerStatusResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityThinReport,
  ResearchContinuityTimelineResponse,
  ResearchContinuityWorkspaceSettingsResponse,
  RunResearchContinuityRepairRequest,
  UpdateResearchContinuitySettingsRequest,
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

export function getResearchContinuityTimeline(
  symbol: string,
  params: {
    include_context?: boolean;
    item_type?: string;
    limit?: number;
    status?: string;
  },
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityTimeline(symbol, params);
}

export function getResearchContinuityEntry(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityEntry(id);
}

export function getResearchContinuityEntryDebug(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityEntryDebug(id);
}

export function getResearchContinuitySettings(auth: WorkspaceRequestContext) {
  return generatedClient(auth).getResearchContinuitySettings();
}

export function updateResearchContinuitySettings(
  request: UpdateResearchContinuitySettingsRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).updateResearchContinuitySettings(request);
}

export function getResearchContinuityScheduler(auth: WorkspaceRequestContext) {
  return generatedClient(auth).getResearchContinuityScheduler();
}

export function runDueResearchContinuityScheduler(
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).runDueResearchContinuityScheduler();
}

export function previewResearchContinuityRepair(
  params: ResearchContinuityRepairPreviewRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).previewResearchContinuityRepair(params);
}

export function runResearchContinuityRepair(
  request: RunResearchContinuityRepairRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).runResearchContinuityRepair(request);
}

export function listResearchContinuityRepairRuns(
  params: { dry_run?: boolean; limit?: number; status?: string },
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).listResearchContinuityRepairRuns(params);
}

export function getResearchContinuityRepairRun(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getResearchContinuityRepairRun(id);
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
  ResearchContinuityEntryDebugResponse,
  ResearchContinuityEntryDetailResponse,
  ResearchContinuityEntryResponse,
  ResearchContinuityEntrySummaryResponse,
  ResearchContinuityRepairPreviewRequest,
  ResearchContinuityRepairPreviewResponse,
  ResearchContinuityRepairRunDetailResponse,
  ResearchContinuityRepairRunResponse,
  ResearchContinuityRepairRunsResponse,
  ResearchContinuityRepairRunSummaryResponse,
  ResearchContinuitySchedulerRunDueResponse,
  ResearchContinuitySchedulerStatusResponse,
  ResearchContinuityStateEnvelopeResponse,
  ResearchContinuityThinReport,
  ResearchContinuityTimelineResponse,
  ResearchContinuityWorkspaceSettingsResponse,
  RunResearchContinuityRepairRequest,
  UpdateResearchContinuitySettingsRequest,
};
