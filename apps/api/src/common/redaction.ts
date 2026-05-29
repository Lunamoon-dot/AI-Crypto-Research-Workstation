import { JsonRecord } from '../database/journal.types';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|token|secret|password|cookie|set-cookie|credential|private[_-]?key)/i;

export function redactForDebug(value: unknown): unknown {
  return redactValue(value, 0);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return TRUNCATED;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1),
      ]),
    );
  }
  if (typeof value === 'string' && value.length > 5000) {
    return `${value.slice(0, 5000)}${TRUNCATED}`;
  }
  return value;
}
