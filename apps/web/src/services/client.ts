import axios, { AxiosError, type Method } from 'axios';
import { env } from '@/lib/env';
import { isApiError, normalizeApiError } from '@/services/api-error';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';

export type { ApiError } from '@/services/api-error';

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
};

const api = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

export const API_BASE_URL = env.apiBaseUrl;

export async function apiRequest<T>(
  path: string,
  options: ApiOptions,
  auth: WorkspaceRequestContext,
): Promise<T> {
  try {
    const response = await api.request<T>({
      url: path,
      method: (options.method ?? 'GET') as Method,
      params: cleanQuery(options.query),
      data: options.body,
      headers: await authHeaders(auth),
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw normalizeApiError(error);
    }
    throw error;
  }
}

export async function authHeaders(auth: WorkspaceRequestContext) {
  if (auth.mode === 'local') {
    return auth.getLocalHeaders();
  }
  const token = await auth.getApiToken();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function cleanQuery(query: ApiOptions['query']) {
  return Object.fromEntries(
    Object.entries(query ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error.';
}
