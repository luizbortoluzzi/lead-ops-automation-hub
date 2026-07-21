import { describe, expect, it } from 'vitest';
import {
  classifyHttpStatus,
  classifyNetworkTimeout,
} from '../../src/common/errors/error-classification';

describe('classifyHttpStatus', () => {
  const cases: [number, string | undefined, string, boolean][] = [
    [400, undefined, 'VALIDATION', false],
    [401, undefined, 'AUTHENTICATION', false],
    [403, undefined, 'AUTHORIZATION', false],
    [404, undefined, 'NOT_FOUND', false],
    [408, undefined, 'TIMEOUT', true],
    [409, 'IDEMPOTENCY_CONFLICT', 'CONFLICT', false],
    [409, 'IDEMPOTENCY_IN_PROGRESS', 'CONFLICT', true],
    [425, undefined, 'DEPENDENCY_UNAVAILABLE', true],
    [429, undefined, 'RATE_LIMIT', true],
    [500, undefined, 'INTERNAL', true],
    [502, undefined, 'DEPENDENCY_UNAVAILABLE', true],
    [503, undefined, 'DEPENDENCY_UNAVAILABLE', true],
    [504, undefined, 'TIMEOUT', true],
    [418, undefined, 'UNKNOWN', false],
  ];

  it.each(cases)('classifies %i / %s → %s (retryable=%s)', (status, code, type, retryable) => {
    const result = classifyHttpStatus(status, code);
    expect(result.errorType).toBe(type);
    expect(result.retryable).toBe(retryable);
  });

  it('defaults unknown statuses to non-retryable UNKNOWN', () => {
    expect(classifyHttpStatus(299)).toEqual({ errorType: 'UNKNOWN', retryable: false });
  });

  it('treats a network timeout as retryable TIMEOUT', () => {
    expect(classifyNetworkTimeout()).toEqual({ errorType: 'TIMEOUT', retryable: true });
  });
});
