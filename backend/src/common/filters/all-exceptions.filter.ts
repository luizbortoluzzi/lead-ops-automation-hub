import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { getCorrelationId } from '../correlation/correlation-id.middleware';
import { AppError, ErrorCode, ErrorCodeValue, ErrorDetail } from '../errors/app-error';

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
 * leak to the client. Technical errors are logged to stdout/stderr with the
 * correlation id; 5xx causes include the stack in dev only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const correlationId = getCorrelationId(request);

    const { statusCode, body, cause } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `[${correlationId ?? '-'}] ${body.error.code} ${this.exceptionName(exception)}: ${body.error.message}`,
        cause instanceof Error ? cause.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${correlationId ?? '-'}] ${body.error.code} (${statusCode}): ${body.error.message}`,
      );
    }

    if (correlationId) {
      void reply.header('X-Correlation-Id', correlationId);
    }
    void reply.status(statusCode).send(body);
  }

  private exceptionName(exception: unknown): string {
    return exception instanceof Error ? exception.name : typeof exception;
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
