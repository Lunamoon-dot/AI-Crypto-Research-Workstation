import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import type {
  CalibrationEvaluationResponse,
  EvaluateThesisRequest,
  EvaluateThesisResponse,
  RecordCalibrationOutcomeReviewRequest,
  RecordCalibrationOutcomeReviewResponse,
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
