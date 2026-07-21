import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app';
import { loadConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig();
  const app = await createApp();

  // Bind to 0.0.0.0 so the server is reachable from other containers.
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.log(`Backend API listening on port ${config.port}`);
}

bootstrap().catch((error) => {
  // Fail loudly on startup errors (invalid config, DB unreachable, etc.).
  new Logger('Bootstrap').error(
    'Failed to start application',
    error instanceof Error ? error.stack : error,
  );
  process.exit(1);
});
