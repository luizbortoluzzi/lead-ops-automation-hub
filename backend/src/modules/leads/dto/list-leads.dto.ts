import { z } from 'zod';

/** Query schema for GET /api/v1/leads. Coerces string query params to numbers. */
export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
