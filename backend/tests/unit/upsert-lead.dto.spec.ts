import { describe, expect, it } from 'vitest';
import { upsertLeadSchema } from '../../src/modules/leads/dto/upsert-lead.dto';

const valid = {
  externalId: 'landing-page-123',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phone: '5511999998888',
  company: 'Acme Ltda',
  employees: 85,
  source: 'landing-page',
};

describe('upsertLeadSchema', () => {
  it('accepts a valid payload', () => {
    expect(upsertLeadSchema.safeParse(valid).success).toBe(true);
  });

  it('normalizes the e-mail and source', () => {
    const parsed = upsertLeadSchema.parse({
      ...valid,
      email: ' MARIA@Example.COM ',
      source: 'LANDING-PAGE',
    });
    expect(parsed.email).toBe('maria@example.com');
    expect(parsed.source).toBe('landing-page');
  });

  it('ignores (strips) score/segment sent by the client', () => {
    const parsed = upsertLeadSchema.parse({
      ...valid,
      score: 999,
      segment: 'enterprise',
    }) as Record<string, unknown>;
    expect(parsed.score).toBeUndefined();
    expect(parsed.segment).toBeUndefined();
  });

  it('rejects an invalid e-mail and missing name', () => {
    expect(upsertLeadSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    const { name, ...rest } = valid;
    void name;
    expect(upsertLeadSchema.safeParse(rest).success).toBe(false);
  });
});
