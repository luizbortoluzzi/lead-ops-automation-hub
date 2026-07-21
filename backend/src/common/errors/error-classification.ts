/**
 * Shared error taxonomy used to classify backend/automation failures and to
 * decide whether a call is worth retrying. Kept conservative: unknown failures
 * are NOT retryable by default.
 */
export const ERROR_TYPES = [
  'VALIDATION',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMIT',
  'TIMEOUT',
  'DEPENDENCY_UNAVAILABLE',
  'DATABASE',
  'INTERNAL',
  'UNKNOWN',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

export interface Classification {
  errorType: ErrorType;
  retryable: boolean;
}

/**
 * Classifies an HTTP status (optionally refined by a body `error.code`) into an
 * {@link ErrorType} and a retryable flag. Mirrors docs/retry-policy.md.
 */
export function classifyHttpStatus(status: number, errorCode?: string | null): Classification {
  switch (status) {
    case 400:
      return { errorType: 'VALIDATION', retryable: false };
    case 401:
      return { errorType: 'AUTHENTICATION', retryable: false };
    case 403:
      return { errorType: 'AUTHORIZATION', retryable: false };
    case 404:
      return { errorType: 'NOT_FOUND', retryable: false };
    case 408:
      return { errorType: 'TIMEOUT', retryable: true };
    case 409:
      // An in-progress idempotent request is transient; a true conflict is not.
      return errorCode === 'IDEMPOTENCY_IN_PROGRESS'
        ? { errorType: 'CONFLICT', retryable: true }
        : { errorType: 'CONFLICT', retryable: false };
    case 425:
      return { errorType: 'DEPENDENCY_UNAVAILABLE', retryable: true };
    case 429:
      return { errorType: 'RATE_LIMIT', retryable: true };
    case 500:
      return { errorType: 'INTERNAL', retryable: true };
    case 502:
      return { errorType: 'DEPENDENCY_UNAVAILABLE', retryable: true };
    case 503:
      return { errorType: 'DEPENDENCY_UNAVAILABLE', retryable: true };
    case 504:
      return { errorType: 'TIMEOUT', retryable: true };
    default:
      return { errorType: 'UNKNOWN', retryable: false };
  }
}

/** A network/connection timeout (no HTTP status) is retryable. */
export function classifyNetworkTimeout(): Classification {
  return { errorType: 'TIMEOUT', retryable: true };
}
