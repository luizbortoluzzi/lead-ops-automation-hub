import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../config/env.schema';
import { UnauthorizedError } from '../errors/app-error';
import { API_KEY_HEADER, IS_PUBLIC_KEY } from './auth.constants';

/**
 * Global guard: every route requires a valid `X-API-Key` unless explicitly
 * marked `@Public()` (e.g. `/health`). The key comes from `BACKEND_API_KEY` and
 * is compared in constant time; it is never logged.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const header = request.headers[API_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;

    if (typeof provided !== 'string' || !this.matches(provided)) {
      throw new UnauthorizedError();
    }
    return true;
  }

  private matches(provided: string): boolean {
    const expected = Buffer.from(this.config.apiKey);
    const actual = Buffer.from(provided);
    // timingSafeEqual requires equal lengths; the length check itself is not
    // secret-dependent, so an early return is fine.
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }
}
