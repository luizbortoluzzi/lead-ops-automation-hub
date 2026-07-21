import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Produces a deterministic SHA-256 of a JSON-serializable value. The
 * serialization is canonical: object keys are sorted recursively, so the same
 * logical payload always hashes the same regardless of key order or whitespace.
 * Arrays keep their order (order is significant for arrays).
 */
@Injectable()
export class CanonicalHashService {
  /** Canonical JSON string with recursively sorted object keys. */
  canonicalize(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  /** SHA-256 (hex) of the canonical serialization of `value`. */
  hash(value: unknown): string {
    return createHash('sha256').update(this.canonicalize(value)).digest('hex');
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }
    if (value !== null && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        const v = source[key];
        if (v === undefined) continue; // undefined is not representable in JSON
        sorted[key] = this.sortValue(v);
      }
      return sorted;
    }
    return value;
  }
}
