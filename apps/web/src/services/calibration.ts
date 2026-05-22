import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  ApplyMaturedEvaluationsRequest,
  ApplyMaturedEvaluationsResponse,
  CalibrationEvaluationResponse,
  CalibrationEvaluationRerunResponse,
  CreateCalibrationEvaluationRerunRequest,
  CreateCalibrationEvaluationRerunResponse,
  EvaluateThesisRequest,
  EvaluateThesisResponse,
  PreviewMaturedEvaluationsRequest,
  PreviewMaturedEvaluationsResponse,
  RecordCalibrationOutcomeReviewRequest,
  RecordCalibrationOutcomeReviewResponse,
  SymbolCalibrationReportResponse,
  SymbolCalibrationRequest,
} from '@/types';

export function evaluateThesis(
  request: EvaluateThesisRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<EvaluateThesisResponse>(
    '/calibration/evaluations/thesis',
    { method: 'POST', body: request },
    auth,
  );
}

export function listCalibrationEvaluations(
  params: { thesis_id?: string; limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<CalibrationEvaluationResponse[]>(
    '/calibration/evaluations',
    { query: { thesis_id: params.thesis_id, limit: params.limit ?? 50 } },
    auth,
  );
}

export function previewMaturedEvaluations(
  request: PreviewMaturedEvaluationsRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<PreviewMaturedEvaluationsResponse>(
    '/calibration/evaluations/matured/preview',
    { method: 'POST', body: request },
    auth,
  );
}

export function applyMaturedEvaluations(
  request: ApplyMaturedEvaluationsRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ApplyMaturedEvaluationsResponse>(
    '/calibration/evaluations/matured/apply',
    { method: 'POST', body: request },
    auth,
  );
}

export function getSymbolCalibrationReport(
  request: SymbolCalibrationRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<SymbolCalibrationReportResponse>(
    '/calibration/symbol',
    { query: request },
    auth,
  );
}

export function getCalibrationEvaluation(
  id: string,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<CalibrationEvaluationResponse>(
    `/calibration/evaluations/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}

export function listCalibrationEvaluationReruns(
  id: string,
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<CalibrationEvaluationRerunResponse[]>(
    `/calibration/evaluations/${encodeURIComponent(id)}/reruns`,
    { query: { limit: params.limit ?? 20 } },
    auth,
  );
}

export function createCalibrationEvaluationRerun(
  id: string,
  request: CreateCalibrationEvaluationRerunRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<CreateCalibrationEvaluationRerunResponse>(
    `/calibration/evaluations/${encodeURIComponent(id)}/reruns`,
    { method: 'POST', body: request },
    auth,
  );
}

export function recordCalibrationOutcomeReview(
  id: string,
  request: RecordCalibrationOutcomeReviewRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<RecordCalibrationOutcomeReviewResponse>(
    `/calibration/evaluations/${encodeURIComponent(id)}/outcome-review`,
    { method: 'POST', body: request },
    auth,
  );
}
