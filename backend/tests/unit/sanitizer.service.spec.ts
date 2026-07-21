import { describe, expect, it } from 'vitest';
import { SanitizerService } from '../../src/common/sanitization/sanitizer.service';

const s = new SanitizerService();

describe('SanitizerService', () => {
  it('redacts sensitive keys case-insensitively', () => {
    const out = s.sanitize({
      Authorization: 'Bearer x',
      'X-API-Key': 'k',
      apiKey: 'k2',
      password: 'p',
      secret: 's',
      token: 't',
      cookie: 'c',
      keep: 'ok',
    }) as Record<string, unknown>;
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out['X-API-Key']).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.cookie).toBe('[REDACTED]');
    expect(out.keep).toBe('ok');
  });

  it('redacts nested sensitive keys and handles arrays', () => {
    const out = s.sanitize({ a: { b: [{ password: 'p', ok: 1 }] } }) as {
      a: { b: { password: string; ok: number }[] };
    };
    expect(out.a.b[0].password).toBe('[REDACTED]');
    expect(out.a.b[0].ok).toBe(1);
  });

  it('does not throw on primitives / null / undefined', () => {
    expect(s.sanitize(null)).toBeNull();
    expect(s.sanitize(42)).toBe(42);
    expect(s.sanitize('x')).toBe('x');
    expect(s.sanitize(undefined)).toBeUndefined();
  });

  it('bounds very long strings', () => {
    const long = 'a'.repeat(5000);
    const out = s.sanitize({ v: long }) as { v: string };
    expect(out.v.length).toBeLessThan(long.length);
  });

  it('bounds deeply nested structures', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    expect(() => s.sanitize(deep)).not.toThrow();
  });

  it('clamps message length', () => {
    expect(s.sanitizeMessage('a'.repeat(5000), 100).length).toBeLessThanOrEqual(101);
  });
});
