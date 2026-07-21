import { Injectable } from '@nestjs/common';

const REDACTED = '[REDACTED]';

/** Keys whose values are always masked (compared case-insensitively). */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'x-api-key',
  'apikey',
  'api_key',
  'password',
  'secret',
  'token',
  'cookie',
  'set-cookie',
]);

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 100;
const MAX_KEYS = 100;

/**
 * Recursively redacts sensitive keys and bounds the size of arbitrary data
 * before it is logged or persisted (e.g. automation-failure payloads, error
 * messages). Never throws on unexpected input.
 */
@Injectable()
export class SanitizerService {
  sanitize(value: unknown): unknown {
    return this.walk(value, 0);
  }

  /** Sanitizes a string message and clamps its length. */
  sanitizeMessage(message: unknown, max = MAX_STRING_LENGTH): string {
    const text = typeof message === 'string' ? message : String(message ?? '');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return '[TRUNCATED]';

    if (typeof value === 'string') {
      return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_LENGTH).map((item) => this.walk(item, depth + 1));
    }

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(source)) {
      if (count++ >= MAX_KEYS) {
        out['…'] = '[TRUNCATED]';
        break;
      }
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED
        : this.walk(source[key], depth + 1);
    }
    return out;
  }
}
