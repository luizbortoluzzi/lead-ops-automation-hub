/** Stable, client-facing error codes. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_UUID: 'INVALID_UUID',
  UNAUTHORIZED: 'UNAUTHORIZED',
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  LEAD_ALREADY_EXISTS: 'LEAD_ALREADY_EXISTS',
  LEAD_IDENTITY_CONFLICT: 'LEAD_IDENTITY_CONFLICT',
  // Idempotency (Phase 3)
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  // Simulated / transient (Phase 3)
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  AUTOMATION_FAILURE_NOT_FOUND: 'AUTOMATION_FAILURE_NOT_FOUND',
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ErrorDetail = {
  path: string;
  message: string;
};

/**
 * Base class for every expected/handled error. Carries the HTTP status, the
 * stable code and optional structured details returned to the client. The
 * optional `cause` holds the underlying technical error for server-side logging
 * only — it is never serialized to the response.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details: ErrorDetail[];
  readonly cause?: unknown;

  constructor(params: {
    statusCode: number;
    code: ErrorCodeValue;
    message: string;
    details?: ErrorDetail[];
    cause?: unknown;
  }) {
    super(params.message);
    this.name = new.target.name;
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details ?? [];
    this.cause = params.cause;
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = 'Invalid request body') {
    super({ statusCode: 400, code: ErrorCode.VALIDATION_ERROR, message, details });
  }
}

export class InvalidUuidError extends AppError {
  constructor(message = 'The provided id is not a valid UUID') {
    super({ statusCode: 400, code: ErrorCode.INVALID_UUID, message });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key') {
    super({ statusCode: 401, code: ErrorCode.UNAUTHORIZED, message });
  }
}

export class LeadNotFoundError extends AppError {
  constructor(message = 'Lead not found') {
    super({ statusCode: 404, code: ErrorCode.LEAD_NOT_FOUND, message });
  }
}

export class LeadAlreadyExistsError extends AppError {
  constructor(message = 'A lead with this e-mail already exists') {
    super({ statusCode: 409, code: ErrorCode.LEAD_ALREADY_EXISTS, message });
  }
}

export class LeadIdentityConflictError extends AppError {
  constructor(message = 'External ID and email reference different leads') {
    super({ statusCode: 409, code: ErrorCode.LEAD_IDENTITY_CONFLICT, message });
  }
}

export class DatabaseError extends AppError {
  constructor(cause: unknown, message = 'A database error occurred') {
    super({ statusCode: 500, code: ErrorCode.DATABASE_ERROR, message, cause });
  }
}

export class IdempotencyKeyRequiredError extends AppError {
  constructor(message = 'Idempotency-Key header is required') {
    super({ statusCode: 400, code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED, message });
  }
}

export class InvalidIdempotencyKeyError extends AppError {
  constructor(message = 'Invalid Idempotency-Key header') {
    super({ statusCode: 400, code: ErrorCode.INVALID_IDEMPOTENCY_KEY, message });
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'The idempotency key was already used with a different request') {
    super({ statusCode: 409, code: ErrorCode.IDEMPOTENCY_CONFLICT, message });
  }
}

export class IdempotencyInProgressError extends AppError {
  constructor(message = 'A request with this idempotency key is already being processed') {
    super({ statusCode: 409, code: ErrorCode.IDEMPOTENCY_IN_PROGRESS, message });
  }
}

export class AutomationFailureNotFoundError extends AppError {
  constructor(message = 'Automation failure not found') {
    super({ statusCode: 404, code: ErrorCode.AUTOMATION_FAILURE_NOT_FOUND, message });
  }
}

/** Simulated/transient errors (development & test only). */
export class SimulatedError extends AppError {
  constructor(statusCode: number, code: ErrorCodeValue, message: string) {
    super({ statusCode, code, message });
  }
}
