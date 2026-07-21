/** Stable, client-facing error codes. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_UUID: 'INVALID_UUID',
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  LEAD_ALREADY_EXISTS: 'LEAD_ALREADY_EXISTS',
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

export class DatabaseError extends AppError {
  constructor(cause: unknown, message = 'A database error occurred') {
    super({ statusCode: 500, code: ErrorCode.DATABASE_ERROR, message, cause });
  }
}
