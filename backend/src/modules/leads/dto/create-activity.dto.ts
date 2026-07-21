import { z } from 'zod';
import { LEAD_ACTIVITY_TYPES } from '../enums/lead-activity-type.enum';

/**
 * Body schema for POST /api/v1/leads/:id/activities. `leadId` is taken from the
 * URL, never the body. Metadata is a bounded JSON object.
 */
export const createActivitySchema = z
  .object({
    type: z.enum(LEAD_ACTIVITY_TYPES),
    description: z.string().trim().min(1).max(1000),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type CreateActivityDto = z.infer<typeof createActivitySchema>;
