import axios, { AxiosError, type Method } from 'axios';
import { env } from '@/lib/env';
import type { WorkspaceRequestContext } from '@/store/useWorkspaceStore';

export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

async function authHeaders(auth: WorkspaceRequestContext) {
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

function normalizeApiError(error: AxiosError): ApiError {
  const response = error.response;
  const payload = response?.data;
  if (isErrorEnvelope(payload)) {
    return {
      status: response?.status ?? 0,
      code: payload.error.code,
      message: payload.error.message,
      details: payload.error.details,
    };
  }
  if (isNestError(payload)) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : String(payload.message ?? response?.statusText ?? error.message);
    return {
      status: response?.status ?? 0,
      code: String(payload.error ?? `http_${response?.status ?? 0}`),
      message,
      details: payload,
    };
  }
  return {
    status: response?.status ?? 0,
    code: response ? `http_${response.status}` : 'network_error',
    message: response?.statusText || error.message || 'API request failed.',
    details: payload,
  };
}

function isErrorEnvelope(value: unknown): value is {
  error: { code: string; message: string; details?: unknown };
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === 'object' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string',
  );
}

function isNestError(value: unknown): value is {
  message?: string | string[];
  error?: string;
} {
  return Boolean(value && typeof value === 'object' && 'message' in value);
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

function isApiError(value: unknown): value is ApiError {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ApiError).status === 'number' &&
      typeof (value as ApiError).message === 'string',
  );
}
