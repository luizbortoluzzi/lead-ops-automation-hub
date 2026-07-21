import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FailureSimulationGuard } from '../../common/simulation/failure-simulation.guard';
import { FailureSimulationService } from '../../common/simulation/failure-simulation.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { IdempotencyKeyGuard } from '../idempotency/idempotency-key.guard';
import { LeadActivitiesController } from './controllers/lead-activities.controller';
import { LeadsController } from './controllers/leads.controller';
import { LeadActivity } from './entities/lead-activity.entity';
import { Lead } from './entities/lead.entity';
import { LeadActivitiesService } from './services/lead-activities.service';
import { LeadScoringService } from './services/lead-scoring.service';
import { LeadsService } from './services/leads.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, LeadActivity]), IdempotencyModule],
  controllers: [LeadsController, LeadActivitiesController],
  providers: [
    LeadsService,
    LeadScoringService,
    LeadActivitiesService,
    FailureSimulationService,
    FailureSimulationGuard,
    IdempotencyKeyGuard,
  ],
})
export class LeadsModule {}
