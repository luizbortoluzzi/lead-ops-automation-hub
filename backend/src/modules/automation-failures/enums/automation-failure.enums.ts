export const AUTOMATION_FAILURE_STATUSES = ['OPEN', 'REPROCESSING', 'RESOLVED', 'IGNORED'] as const;
export type AutomationFailureStatus = (typeof AUTOMATION_FAILURE_STATUSES)[number];

/** Operations that can fail in the automation (controlled vocabulary). */
export const AUTOMATION_OPERATIONS = [
  'LEAD_UPSERT',
  'SEND_ENTERPRISE_NOTIFICATION',
  'REGISTER_ACTIVITY',
  'OTHER',
] as const;
export type AutomationOperation = (typeof AUTOMATION_OPERATIONS)[number];
