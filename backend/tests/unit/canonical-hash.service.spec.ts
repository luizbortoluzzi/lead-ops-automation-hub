import { describe, expect, it } from 'vitest';
import { CanonicalHashService } from '../../src/common/hashing/canonical-hash.service';
import { buildCanonicalLead, upsertLeadSchema } from '../../src/modules/leads/dto/upsert-lead.dto';

const hasher = new CanonicalHashService();

const canonicalOf = (raw: unknown) => buildCanonicalLead(upsertLeadSchema.parse(raw));

const base = {
  externalId: 'landing-page-123',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phone: '5511999998888',
  company: 'Acme Ltda',
  employees: 85,
  source: 'landing-page',
};

describe('CanonicalHashService', () => {
  it('is stable regardless of key order', () => {
    const a = hasher.hash({ a: 1, b: 2, c: { x: 1, y: 2 } });
    const b = hasher.hash({ c: { y: 2, x: 1 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('ignores JSON whitespace/formatting (same logical value)', () => {
    expect(hasher.hash({ name: 'x' })).toBe(hasher.hash(JSON.parse('{ "name":   "x" }')));
  });

  it('produces a different hash for a genuinely different payload', () => {
    expect(hasher.hash({ a: 1 })).not.toBe(hasher.hash({ a: 2 }));
  });
});

describe('buildCanonicalLead + hash', () => {
  it('same logical payload with different key order hashes equal', () => {
    const h1 = hasher.hash(canonicalOf(base));
    const h2 = hasher.hash(
      canonicalOf({
        source: 'landing-page',
        email: 'maria@example.com',
        name: 'Maria Silva',
        employees: 85,
        phone: '5511999998888',
        company: 'Acme Ltda',
        externalId: 'landing-page-123',
      }),
    );
    expect(h1).toBe(h2);
  });

  it('normalizes e-mail case and whitespace before hashing', () => {
    const h1 = hasher.hash(canonicalOf(base));
    const h2 = hasher.hash(canonicalOf({ ...base, email: '  MARIA@Example.COM ' }));
    expect(h1).toBe(h2);
  });

  it('ignores client-sent score and segment', () => {
    const h1 = hasher.hash(canonicalOf(base));
    const h2 = hasher.hash(canonicalOf({ ...base, score: 999, segment: 'enterprise' }));
    expect(h1).toBe(h2);
  });

  it('changes when a real field changes', () => {
    const h1 = hasher.hash(canonicalOf(base));
    const h2 = hasher.hash(canonicalOf({ ...base, employees: 10 }));
    expect(h1).not.toBe(h2);
  });
});
