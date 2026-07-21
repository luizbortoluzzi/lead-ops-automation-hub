import { describe, expect, it } from 'vitest';
import {
  createLeadSchema,
  listLeadsQuerySchema,
  normalizeEmail,
} from '../../src/schemas/lead.schema';

const validPayload = {
  externalId: 'landing-page-123',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phone: '5511999998888',
  company: 'Acme Ltda',
  employees: 85,
  source: 'landing-page',
  score: 65,
  segment: 'medium',
};

describe('createLeadSchema', () => {
  it('accepts a valid payload', () => {
    const result = createLeadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('normalizes the e-mail to lowercase and trims it', () => {
    const result = createLeadSchema.parse({ ...validPayload, email: '  MARIA@Example.COM ' });
    expect(result.email).toBe('maria@example.com');
  });

  it('applies defaults for optional numeric fields', () => {
    const { employees, score, ...rest } = validPayload;
    void employees;
    void score;
    const result = createLeadSchema.parse(rest);
    expect(result.employees).toBe(0);
    expect(result.score).toBe(0);
  });

  it('rejects a missing name', () => {
    const { name, ...rest } = validPayload;
    void name;
    expect(createLeadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid e-mail', () => {
    expect(createLeadSchema.safeParse({ ...validPayload, email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('rejects a negative employee count', () => {
    expect(createLeadSchema.safeParse({ ...validPayload, employees: -1 }).success).toBe(false);
  });

  it('rejects an unknown segment', () => {
    expect(createLeadSchema.safeParse({ ...validPayload, segment: 'huge' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(createLeadSchema.safeParse({ ...validPayload, hacker: true }).success).toBe(false);
  });
});

describe('listLeadsQuerySchema', () => {
  it('coerces string query params and applies defaults', () => {
    expect(listLeadsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listLeadsQuerySchema.parse({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });
  });

  it('rejects page below 1', () => {
    expect(listLeadsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects limit above 100', () => {
    expect(listLeadsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});
