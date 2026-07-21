export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Property name under which the correlation id is stored on the request. */
export const CORRELATION_ID_KEY = 'correlationId';

/** Reject absurd values; accept UUIDs or short opaque tokens the caller sends. */
export const CORRELATION_ID_MAX_LENGTH = 128;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** Returns the incoming value if it is a sane correlation id, else null. */
export function sanitizeCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CORRELATION_ID_MAX_LENGTH) {
    return null;
  }
  return CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : null;
}
