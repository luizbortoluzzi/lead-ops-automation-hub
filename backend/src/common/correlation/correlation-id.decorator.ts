import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getCorrelationId } from './correlation-id.middleware';

/** Injects the current request's correlation id into a handler parameter. */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return getCorrelationId(request);
  },
);
