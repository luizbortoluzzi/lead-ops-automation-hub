import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/env.schema';
import { Lead } from '../modules/leads/entities/lead.entity';
import { LeadActivity } from '../modules/leads/entities/lead-activity.entity';
import { ProcessedRequest } from '../modules/idempotency/entities/processed-request.entity';
import { AutomationFailure } from '../modules/automation-failures/entities/automation-failure.entity';
import { InitialSchema1721520000000 } from './migrations/1721520000000-InitialSchema';
import { LeadActivities1721600000000 } from './migrations/1721600000000-LeadActivities';
import { Phase3IdempotencyAndFailures1721700000000 } from './migrations/1721700000000-Phase3IdempotencyAndFailures';

/**
 * Single source of truth for the TypeORM connection, shared by the Nest module
 * and the CLI DataSource. Entities and migrations are referenced by class (not
 * globs) so it works identically from TS (dev/test) and compiled JS (prod).
 */
export function buildDataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.databaseUrl,
    entities: [Lead, LeadActivity, ProcessedRequest, AutomationFailure],
    migrations: [
      InitialSchema1721520000000,
      LeadActivities1721600000000,
      Phase3IdempotencyAndFailures1721700000000,
    ],
    // Apply pending migrations on startup; never auto-sync the schema.
    migrationsRun: true,
    synchronize: false,
    // The exception filter is the single source of truth for error logging, so
    // outside development TypeORM only logs migrations (keeps expected failures
    // like duplicate-key 409s from spamming stdout with the failed query).
    logging: config.nodeEnv === 'development' ? ['error', 'warn', 'migration'] : ['migration'],
  };
}
