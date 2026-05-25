const POSTGRES_CONNECTION_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export function shouldUseLocalPostgresFallback(
  databaseUrl: string | undefined,
  error: unknown,
): boolean {
  return (
    isLocalPostgresUrl(databaseUrl) &&
    isPostgresConnectionUnavailable(error)
  );
}

function isLocalPostgresUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return /(^|[@:/])(localhost|127\.0\.0\.1|\[?::1\]?)([:/]|$)/i.test(
      databaseUrl,
    );
  }
}

function isPostgresConnectionUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
    message?: unknown;
  };
  if (
    typeof record.code === 'string' &&
    POSTGRES_CONNECTION_UNAVAILABLE_CODES.has(record.code)
  ) {
    return true;
  }
  if (
    Array.isArray(record.errors) &&
    record.errors.some(isPostgresConnectionUnavailable)
  ) {
    return true;
  }
  if (
    record.cause &&
    record.cause !== error &&
    isPostgresConnectionUnavailable(record.cause)
  ) {
    return true;
  }
  const message = typeof record.message === 'string' ? record.message : '';
  return [...POSTGRES_CONNECTION_UNAVAILABLE_CODES].some((code) =>
    message.includes(code),
  );
}
