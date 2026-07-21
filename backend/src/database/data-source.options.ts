import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/env.schema';
import { Lead } from '../leads/lead.entity';
import { InitialSchema1721520000000 } from './migrations/1721520000000-InitialSchema';

/**
 * Single source of truth for the TypeORM connection, shared by the Nest module
 * and the CLI DataSource. Entities and migrations are referenced by class (not
 * globs) so it works identically from TS (dev/test) and compiled JS (prod).
 */
export function buildDataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.databaseUrl,
    entities: [Lead],
    migrations: [InitialSchema1721520000000],
    // Apply pending migrations on startup; never auto-sync the schema.
    migrationsRun: true,
    synchronize: false,
    // The exception filter is the single source of truth for error logging, so
    // outside development TypeORM only logs migrations (keeps expected failures
    // like duplicate-key 409s from spamming stdout with the failed query).
    logging: config.nodeEnv === 'development' ? ['error', 'warn', 'migration'] : ['migration'],
  };
}
