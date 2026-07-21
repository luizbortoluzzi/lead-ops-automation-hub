import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { AppError, ErrorCode, ErrorCodeValue, ErrorDetail } from './app-error';

type ErrorBody = {
  error: {
    code: ErrorCodeValue;
    message: string;
    details: ErrorDetail[];
  };
};

/**
 * Central error handler. Every thrown error funnels through here so responses
 * share one shape and internal details (stack traces, SQL, credentials) never
 * leak to the client. Technical errors are logged to stdout/stderr instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const { statusCode, body, cause } = this.normalize(exception);

    // Log technical failures (5xx) with the underlying cause; keep the client
    // response free of internals.
    if (statusCode >= 500) {
      this.logger.error(
        `${body.error.code}: ${body.error.message}`,
        cause instanceof Error ? cause.stack : exception,
      );
    }

    void reply.status(statusCode).send(body);
  }

  private normalize(exception: unknown): {
    statusCode: number;
    body: ErrorBody;
    cause?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.statusCode,
        cause: exception.cause,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
          },
        },
      };
    }

    // Nest built-in HttpExceptions (e.g. 404 for unknown routes).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        cause: exception,
        body: {
          error: {
            code: status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR,
            message: exception.message,
            details: [],
          },
        },
      };
    }

    return {
      statusCode: 500,
      cause: exception,
      body: {
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: 'An unexpected error occurred',
          details: [],
        },
      },
    };
  }
}
