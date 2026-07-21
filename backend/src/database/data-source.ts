import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/env.schema';
import { buildDataSourceOptions } from './data-source.options';

/**
 * Standalone DataSource for the TypeORM CLI (migration generate/run/revert).
 * The running application configures TypeORM through the Nest module instead.
 */
export default new DataSource(buildDataSourceOptions(loadConfig()));
