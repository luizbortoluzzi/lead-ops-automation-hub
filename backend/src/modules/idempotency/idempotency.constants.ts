export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** Rejects empty keys, keys that are too long, or keys with control characters. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type KeyValidation =
  { valid: true; value: string } | { valid: false; reason: 'missing' | 'invalid' };

export function validateIdempotencyKey(raw: unknown): KeyValidation {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, reason: 'missing' };
  }
  if (typeof value !== 'string') {
    return { valid: false, reason: 'invalid' };
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH || CONTROL_CHARS.test(trimmed)) {
    return { valid: false, reason: 'invalid' };
  }
  return { valid: true, value: trimmed };
}
