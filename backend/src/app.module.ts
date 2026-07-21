import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, LeadsModule],
})
export class AppModule {}
