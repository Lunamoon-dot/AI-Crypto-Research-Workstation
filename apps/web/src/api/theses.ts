import { AuthContextValue } from '@/auth/auth-types';
import { apiRequest } from '@/api/client';
import {
  RecordThesisDecisionRequest,
  RecordThesisReviewRequest,
  ScenarioResponse,
  ThesisDecisionResponse,
  ThesisResponse,
  ThesisReviewResponse,
} from '@/api/types';

export function listTheses(
  params: { limit?: number },
  auth: AuthContextValue,
) {
  return apiRequest<ThesisResponse[]>(
    '/theses',
    { query: { limit: params.limit ?? 50 } },
    auth,
  );
}

export function getThesis(id: string, auth: AuthContextValue) {
  return apiRequest<ThesisResponse>(
    `/theses/${encodeURIComponent(id)}`,
    {},
    auth,
  );
}

export function getThesisScenarios(id: string, auth: AuthContextValue) {
  return apiRequest<ScenarioResponse[]>(
    `/theses/${encodeURIComponent(id)}/scenarios`,
    {},
    auth,
  );
}

export function recordThesisDecision(
  id: string,
  request: RecordThesisDecisionRequest,
  auth: AuthContextValue,
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
  auth: AuthContextValue,
) {
  return apiRequest<ThesisReviewResponse>(
    `/theses/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: request },
    auth,
  );
}
