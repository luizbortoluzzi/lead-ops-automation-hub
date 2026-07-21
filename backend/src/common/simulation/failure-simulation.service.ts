import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/env.schema';
import { ErrorCode, ErrorCodeValue } from '../errors/app-error';

export const SIMULATE_ERROR_HEADER = 'x-simulate-error';

export interface SimulatedAction {
  kind: 'error' | 'timeout';
  statusCode: number;
  code: ErrorCodeValue;
  message: string;
  retryAfterSeconds?: number;
}

/**
 * Maps the `X-Simulate-Error` header to a controlled failure. Active ONLY when
 * `failureSimulationEnabled` (dev/test with the flag on) — always inert in
 * production. The mapping is centralized here so the guard stays thin and the
 * behavior is unit-testable.
 */
@Injectable()
export class FailureSimulationService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.failureSimulationEnabled;
  }

  resolve(headerValue: unknown): SimulatedAction | null {
    if (!this.enabled) return null;
    const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof value !== 'string') return null;

    switch (value.trim().toLowerCase()) {
      case 'rate-limit':
        return {
          kind: 'error',
          statusCode: 429,
          code: ErrorCode.RATE_LIMITED,
          message: 'Simulated rate limit',
          retryAfterSeconds: 2,
        };
      case 'server-error':
        return {
          kind: 'error',
          statusCode: 500,
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Simulated server error',
        };
      case 'service-unavailable':
        return {
          kind: 'error',
          statusCode: 503,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Simulated service unavailable',
        };
      case 'bad-request':
        return {
          kind: 'error',
          statusCode: 400,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Simulated bad request',
        };
      case 'timeout':
        return {
          kind: 'timeout',
          statusCode: 504,
          code: ErrorCode.GATEWAY_TIMEOUT,
          message: 'Simulated timeout',
        };
      default:
        return null; // unknown value → no simulation
    }
  }
}
