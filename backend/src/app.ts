import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Builds the Nest application on the Fastify adapter and wires cross-cutting
 * concerns (global error filter, graceful shutdown hooks). The app is returned
 * un-listened so callers decide: `server.ts` calls `listen()`, while tests call
 * `init()` and drive it through `app.inject()`.
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: new Logger(),
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  // Ensures TypeORM closes its connection pool on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  return app;
}
