import { apiRequest } from '@/services/client';
import {
  createApiClient,
  type CloseSimulationRequest,
} from '@/services/generated/api-client';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import type {
  CreateSimulationRequest,
  ExecutionEventResponse,
  PaperOrderResponse,
  PaperPositionResponse,
  SimulationDetailResponse,
  SimulationOutcomeResponse,
  SimulationRunResponse,
} from '@/types';

export function createPlaybookSimulation(
  playbookId: string,
  body: CreateSimulationRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).createPlaybookSimulation(playbookId, body);
}

export function listPlaybookSimulations(
  playbookId: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).listPlaybookSimulations(playbookId);
}

export function getSimulation(
  simulationId: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).getSimulation(simulationId);
}

export function refreshSimulation(
  simulationId: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).refreshSimulation(simulationId);
}

export function cancelSimulation(
  simulationId: string,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).cancelSimulation(simulationId);
}

export function closeSimulation(
  simulationId: string,
  body: CloseSimulationRequest,
  auth: WorkspaceRequestContext,
) {
  return generatedClient(auth).closeSimulation(simulationId, body);
}

function generatedClient(auth: WorkspaceRequestContext) {
  return createApiClient((path, options) =>
    apiRequest(path, options, auth),
  );
}

export type {
  CloseSimulationRequest,
  CreateSimulationRequest,
  ExecutionEventResponse,
  PaperOrderResponse,
  PaperPositionResponse,
  SimulationDetailResponse,
  SimulationOutcomeResponse,
  SimulationRunResponse,
};
