import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfig } from '../config/env.schema';
import { buildDataSourceOptions } from './data-source.options';

/**
 * Configures TypeORM from the validated {@link AppConfig}. Global so the
 * DataSource is available app-wide; feature repositories are registered per
 * module via `TypeOrmModule.forFeature`.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        ...buildDataSourceOptions(config),
        // Tolerate Postgres coming up slightly after the app.
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
