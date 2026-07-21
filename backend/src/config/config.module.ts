import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './env.schema';

/**
 * Validates the environment once at bootstrap and exposes the resulting
 * {@link AppConfig} under the {@link APP_CONFIG} token. Global so any provider
 * can inject it without importing this module explicitly.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
