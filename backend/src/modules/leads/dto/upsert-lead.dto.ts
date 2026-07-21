import { z } from 'zod';

/** Normalizes an e-mail for case-insensitive storage and lookup. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Body schema for POST /api/v1/leads/upsert. `score` and `segment` are NOT part
 * of the schema, so if a caller sends them they are silently stripped (ignored)
 * — the backend always recomputes them. Other unknown keys are stripped too
 * (Zod's default), keeping the contract forgiving for the n8n layer.
 */
export const upsertLeadSchema = z.object({
  externalId: z.string().trim().min(1).max(255).optional(),
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(320).transform(normalizeEmail),
  phone: z.string().trim().min(1).max(50).optional(),
  company: z.string().trim().min(1).max(255).optional(),
  employees: z.coerce.number().int().nonnegative().default(0),
  source: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((s) => s.toLowerCase())
    .optional(),
});

export type UpsertLeadDto = z.infer<typeof upsertLeadSchema>;
