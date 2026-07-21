import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../common/errors/app-error';
import { IDEMPOTENCY_KEY_HEADER, validateIdempotencyKey } from './idempotency.constants';

/**
 * Validates the `Idempotency-Key` header before the request body is parsed, so
 * a missing/invalid key fails fast with the right error code.
 */
@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const validation = validateIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (!validation.valid) {
      throw validation.reason === 'missing'
        ? new IdempotencyKeyRequiredError()
        : new InvalidIdempotencyKeyError();
    }
    return true;
  }
}
