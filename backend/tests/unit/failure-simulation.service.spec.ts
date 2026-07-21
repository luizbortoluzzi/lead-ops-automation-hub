import { describe, expect, it } from 'vitest';
import { FailureSimulationService } from '../../src/common/simulation/failure-simulation.service';
import type { AppConfig } from '../../src/config/env.schema';

function makeService(enabled: boolean): FailureSimulationService {
  const config = { failureSimulationEnabled: enabled } as AppConfig;
  return new FailureSimulationService(config);
}

describe('FailureSimulationService', () => {
  const svc = makeService(true);

  it('maps rate-limit to 429 with Retry-After', () => {
    expect(svc.resolve('rate-limit')).toMatchObject({ statusCode: 429, retryAfterSeconds: 2 });
  });

  it('maps server-error/service-unavailable/bad-request', () => {
    expect(svc.resolve('server-error')?.statusCode).toBe(500);
    expect(svc.resolve('service-unavailable')?.statusCode).toBe(503);
    expect(svc.resolve('bad-request')?.statusCode).toBe(400);
  });

  it('maps timeout to a timeout action (504)', () => {
    expect(svc.resolve('timeout')).toMatchObject({ kind: 'timeout', statusCode: 504 });
  });

  it('returns null for unknown values', () => {
    expect(svc.resolve('nope')).toBeNull();
    expect(svc.resolve(undefined)).toBeNull();
  });

  it('is inert when disabled (production block)', () => {
    const disabled = makeService(false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.resolve('rate-limit')).toBeNull();
  });
});
