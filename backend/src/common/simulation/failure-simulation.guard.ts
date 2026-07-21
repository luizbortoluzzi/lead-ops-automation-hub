import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { APP_CONFIG, AppConfig } from '../../config/env.schema';
import { SimulatedError } from '../errors/app-error';
import { getCorrelationId } from '../correlation/correlation-id.middleware';
import { FailureSimulationService, SIMULATE_ERROR_HEADER } from './failure-simulation.service';

/**
 * Route guard that turns the `X-Simulate-Error` header into a controlled
 * failure (dev/test only). Runs before validation pipes so the simulated error
 * is not preempted. Timeout simulation stalls the response before failing.
 */
@Injectable()
export class FailureSimulationGuard implements CanActivate {
  private readonly logger = new Logger('FailureSimulation');

  constructor(
    private readonly simulation: FailureSimulationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers: Record<string, unknown> }>();
    const action = this.simulation.resolve(request.headers[SIMULATE_ERROR_HEADER]);
    if (!action) return true;

    const correlationId = getCorrelationId(request) ?? '-';
    this.logger.warn(`[${correlationId}] simulated failure: ${action.code} (${action.statusCode})`);

    if (action.kind === 'timeout') {
      await sleep(this.config.simulatedTimeoutDelayMs);
    } else if (action.retryAfterSeconds !== undefined) {
      const reply = http.getResponse<FastifyReply>();
      void reply.header('Retry-After', String(action.retryAfterSeconds));
    }

    throw new SimulatedError(action.statusCode, action.code, action.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
