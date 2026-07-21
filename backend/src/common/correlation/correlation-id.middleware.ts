import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_KEY,
  sanitizeCorrelationId,
} from './correlation.constants';

/**
 * Ensures every request has a correlation id:
 *  - reuses a sane incoming `X-Correlation-Id`, or generates a UUID;
 *  - exposes it on the request (`req.correlationId`) for logs/handlers;
 *  - echoes it back on the response header for the caller (n8n) to chain.
 *
 * Registered on the Fastify (raw) request/response, so it works with the
 * platform-fastify adapter.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const value = sanitizeCorrelationId(Array.isArray(incoming) ? incoming[0] : incoming);
    const correlationId = value ?? randomUUID();

    (req as unknown as Record<string, string>)[CORRELATION_ID_KEY] = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);

    next();
  }
}

/** Reads the correlation id previously attached by the middleware. */
export function getCorrelationId(req: unknown): string | undefined {
  if (typeof req !== 'object' || req === null) {
    return undefined;
  }
  const direct = (req as Record<string, unknown>)[CORRELATION_ID_KEY];
  if (typeof direct === 'string') {
    return direct;
  }
  // Nest's Fastify request wraps the raw request under `.raw`.
  const raw = (req as { raw?: Record<string, unknown> }).raw;
  const fromRaw = raw?.[CORRELATION_ID_KEY];
  return typeof fromRaw === 'string' ? fromRaw : undefined;
}
