import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';
import { apiRequest } from '@/services/client';
import { normalizeThesisResponse } from './thesis-response-normalizer';
import {
  RecordThesisDecisionRequest,
  RecordThesisReviewRequest,
  ScenarioResponse,
  ThesisDecisionResponse,
  ThesisResponse,
  ThesisReviewResponse,
} from '@/types';

export function listTheses(
  params: { limit?: number },
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisResponse[]>(
    '/theses',
    { query: { limit: params.limit ?? 50 } },
    auth,
  ).then((theses) => theses.map(normalizeThesisResponse));
}

export function getThesis(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<ThesisResponse>(
    `/theses/${encodeURIComponent(id)}`,
    {},
    auth,
  ).then(normalizeThesisResponse);
}

export function getThesisScenarios(id: string, auth: WorkspaceRequestContext) {
  return apiRequest<ScenarioResponse[]>(
    `/theses/${encodeURIComponent(id)}/scenarios`,
    {},
    auth,
  );
}

export function recordThesisDecision(
  id: string,
  request: RecordThesisDecisionRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisDecisionResponse>(
    `/theses/${encodeURIComponent(id)}/decision`,
    { method: 'POST', body: request },
    auth,
  );
}

export function recordThesisReview(
  id: string,
  request: RecordThesisReviewRequest,
  auth: WorkspaceRequestContext,
) {
  return apiRequest<ThesisReviewResponse>(
    `/theses/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: request },
    auth,
  );
}
