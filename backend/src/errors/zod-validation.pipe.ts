import { PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';
import { ValidationError } from './app-error';

/**
 * Validates and transforms an incoming value against a Zod schema, turning any
 * failure into a {@link ValidationError} (HTTP 400). Returns the parsed value so
 * downstream code receives normalized/typed data (e.g. lowercased e-mails,
 * coerced numbers, applied defaults).
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ValidationError(this.toDetails(result.error));
    }

    return result.data;
  }

  private toDetails(error: ZodError): { path: string; message: string }[] {
    return error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
}
