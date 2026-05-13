import { AuthContextValue } from '@/auth/auth-types';
import { hostedAuthHeaders } from '@/auth/hosted-auth';
import { localAuthHeaders } from '@/auth/local-auth';
import { env } from '@/lib/env';

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

export async function apiRequest<T>(
  path: string,
  options: ApiOptions,
  auth: AuthContextValue,
): Promise<T> {
  const url = new URL(`${env.apiBaseUrl}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const authHeaders =
    auth.mode === 'local'
      ? localAuthHeaders(auth)
      : await hostedAuthHeaders(auth);
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw normalizeApiError(response, payload);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeApiError(response: Response, payload: unknown): ApiError {
  if (isErrorEnvelope(payload)) {
    return {
      status: response.status,
      code: payload.error.code,
      message: payload.error.message,
      details: payload.error.details,
    };
  }
  if (isNestError(payload)) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : String(payload.message ?? response.statusText);
    return {
      status: response.status,
      code: String(payload.error ?? `http_${response.status}`),
      message,
      details: payload,
    };
  }
  return {
    status: response.status,
    code: `http_${response.status}`,
    message: response.statusText || 'API request failed.',
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
