import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import {
  SignalCountResponse,
  SignalDetailResponse,
  SignalEvaluationReportResponse,
  SignalModelMonitoringSnapshotResponse,
  SignalResponse,
} from '@/types';

export function listSignals(
  params: { symbol?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SignalResponse[]>(
    '/signals',
    { query: { symbol: params.symbol, limit: params.limit ?? 50 } },
    auth,
  );
}

export function countSignals(
  params: { symbol?: string },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SignalCountResponse>(
    '/signals/count',
    { query: { symbol: params.symbol } },
    auth,
  );
}

export function getSignal(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<SignalDetailResponse>(
    `/signals/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}

export function listSignalEvaluationReports(
  params: { symbol?: string; factor?: string; horizon?: number; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SignalEvaluationReportResponse[]>(
    '/signals/evaluation/reports',
    {
      query: {
        symbol: params.symbol,
        factor: params.factor,
        horizon: params.horizon,
        limit: params.limit ?? 3,
      },
    },
    auth,
  );
}

export function getSignalModelMonitoringLatest(auth: WorkspaceRequestContext) {
  return apiRequest<SignalModelMonitoringSnapshotResponse>(
    '/signals/models/monitoring/latest',
    {},
    auth,
  );
}
