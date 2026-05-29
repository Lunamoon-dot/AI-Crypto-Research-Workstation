import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeApiError } from '../src/services/api-error.ts';

test('normalizeApiError prefers Nest payload code over generic HTTP status', () => {
  const error = normalizeApiError({
    message: 'Request failed with status code 403',
    response: {
      status: 403,
      statusText: 'Forbidden',
      data: {
        statusCode: 403,
        message: 'Research continuity debug access is disabled by policy.',
        code: 'debug_access_disabled',
      },
    },
  });

  assert.equal(error.status, 403);
  assert.equal(error.code, 'debug_access_disabled');
  assert.equal(
    error.message,
    'Research continuity debug access is disabled by policy.',
  );
});
