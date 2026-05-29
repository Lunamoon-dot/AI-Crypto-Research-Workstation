import type { AxiosError } from 'axios';

export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

type AxiosLikeError = Pick<AxiosError, 'message'> & {
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
};

export function normalizeApiError(error: AxiosLikeError): ApiError {
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
      code: nestErrorCode(payload, response?.status),
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

export function isApiError(value: unknown): value is ApiError {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ApiError).status === 'number' &&
      typeof (value as ApiError).message === 'string',
  );
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
  code?: string;
} {
  return Boolean(value && typeof value === 'object' && 'message' in value);
}

function nestErrorCode(
  payload: { code?: string; error?: string },
  status: number | undefined,
): string {
  if (typeof payload.code === 'string' && payload.code.length > 0) {
    return payload.code;
  }
  if (typeof payload.error === 'string' && payload.error.length > 0) {
    return payload.error;
  }
  return `http_${status ?? 0}`;
}
