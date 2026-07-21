import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiKeyGuard } from './common/auth/api-key.guard';
import { CommonModule } from './common/common.module';
import { CorrelationIdMiddleware } from './common/correlation/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AutomationFailuresModule } from './modules/automation-failures/automation-failures.module';
import { HealthModule } from './modules/health/health.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { LeadsModule } from './modules/leads/leads.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    HealthModule,
    LeadsModule,
    IdempotencyModule,
    AutomationFailuresModule,
  ],
  providers: [
    // API key required everywhere except @Public() routes (e.g. /health).
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    // One structured log line per request (with correlation id).
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
