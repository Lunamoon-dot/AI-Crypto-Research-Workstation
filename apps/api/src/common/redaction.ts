import { JsonRecord } from '../database/journal.types';

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const MAX_STRING_LENGTH = 5000;
const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|token|secret|password|cookie|set-cookie|credential|private[_-]?key)/i;

export function redactForDebug(value: unknown): unknown {
  return redactValue(value, 0);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return TRUNCATED;
  }
  if (Array.isArray(value)) {
    const redacted = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      redacted.push({
        __truncated__: true,
        omitted_count: value.length - MAX_ARRAY_ITEMS,
      });
    }
    return redacted;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonRecord);
    const redacted = Object.fromEntries(
      entries.slice(0, MAX_OBJECT_KEYS).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1),
      ]),
    ) as JsonRecord;
    if (entries.length > MAX_OBJECT_KEYS) {
      redacted.__truncated__ = true;
      redacted.__omitted_key_count__ = entries.length - MAX_OBJECT_KEYS;
    }
    return redacted;
  }
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
  }
  return value;
}
