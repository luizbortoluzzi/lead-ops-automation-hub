import { z } from 'zod';

export const SEGMENTS = ['small', 'medium', 'enterprise'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Normalizes an e-mail for case-insensitive storage and lookup. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Body schema for POST /api/leads. Rejects unknown keys. */
export const createLeadSchema = z
  .object({
    externalId: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(320).transform(normalizeEmail),
    phone: z.string().trim().min(1).max(50).optional(),
    company: z.string().trim().min(1).max(255).optional(),
    employees: z.number().int().nonnegative().default(0),
    source: z.string().trim().min(1).max(100).optional(),
    score: z.number().int().nonnegative().default(0),
    segment: z.enum(SEGMENTS),
  })
  .strict();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/** Query schema for GET /api/leads. Coerces string query params to numbers. */
export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
