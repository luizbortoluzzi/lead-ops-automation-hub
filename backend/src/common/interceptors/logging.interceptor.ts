import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';
import { getCorrelationId } from '../correlation/correlation-id.middleware';

/**
 * Logs one line per request with correlation id, method, path, status and
 * duration. Never logs headers or bodies, so API keys and payloads stay out of
 * the logs.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const correlationId = getCorrelationId(request) ?? '-';
    const { method, url } = request;
    const start = process.hrtime.bigint();

    const log = () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      this.logger.log(
        `[${correlationId}] ${method} ${url} ${reply.statusCode} ${durationMs.toFixed(1)}ms`,
      );
    };

    return next.handle().pipe(
      tap({
        next: log,
        // On error the exception filter logs the failure; still record timing.
        error: log,
      }),
    );
  }
}
