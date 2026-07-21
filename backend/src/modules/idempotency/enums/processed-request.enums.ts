export const PROCESSED_REQUEST_STATUSES = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type ProcessedRequestStatus = (typeof PROCESSED_REQUEST_STATUSES)[number];

/** Controlled set of idempotent operations (extend as new ones are added). */
export const IDEMPOTENCY_OPERATIONS = ['LEAD_UPSERT'] as const;
export type IdempotencyOperation = (typeof IDEMPOTENCY_OPERATIONS)[number];
