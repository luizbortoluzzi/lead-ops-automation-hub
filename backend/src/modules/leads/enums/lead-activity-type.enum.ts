/**
 * Controlled vocabulary for lead activity types. Mirrored by a CHECK constraint
 * in the database migration so unknown values cannot be persisted.
 */
export const LEAD_ACTIVITY_TYPES = [
  'AUTOMATION_PROCESSED',
  'ENTERPRISE_NOTIFICATION_SENT',
  'AUTOMATION_NOTIFICATION_FAILED',
] as const;

export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];
