import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadActivitiesController } from './controllers/lead-activities.controller';
import { LeadsController } from './controllers/leads.controller';
import { LeadActivity } from './entities/lead-activity.entity';
import { Lead } from './entities/lead.entity';
import { LeadActivitiesService } from './services/lead-activities.service';
import { LeadScoringService } from './services/lead-scoring.service';
import { LeadsService } from './services/leads.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, LeadActivity])],
  controllers: [LeadsController, LeadActivitiesController],
  providers: [LeadsService, LeadScoringService, LeadActivitiesService],
})
export class LeadsModule {}
