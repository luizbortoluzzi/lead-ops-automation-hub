import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatabaseError } from '../../../common/errors/app-error';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { LeadActivity } from '../entities/lead-activity.entity';
import { LeadActivityResponse, toLeadActivityResponse } from '../types/lead-response';
import { LeadsService } from './leads.service';

@Injectable()
export class LeadActivitiesService {
  constructor(
    @InjectRepository(LeadActivity)
    private readonly activities: Repository<LeadActivity>,
    private readonly leads: LeadsService,
  ) {}

  /**
   * Records an activity for an existing lead. `leadId` comes from the URL and is
   * validated to exist (404 otherwise); the body can never override it.
   */
  async create(
    leadId: string,
    input: CreateActivityDto,
    correlationId: string | null,
  ): Promise<LeadActivityResponse> {
    await this.leads.getEntityOrThrow(leadId); // throws LeadNotFoundError (404)

    try {
      const activity = this.activities.create({
        leadId,
        type: input.type,
        description: input.description,
        metadata: input.metadata,
        correlationId,
      });
      const saved = await this.activities.save(activity);
      return toLeadActivityResponse(saved);
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  /** Lists a lead's activities (newest first). 404 when the lead does not exist. */
  async listForLead(leadId: string): Promise<LeadActivityResponse[]> {
    await this.leads.getEntityOrThrow(leadId); // throws LeadNotFoundError (404)
    try {
      const rows = await this.activities.find({
        where: { leadId },
        order: { createdAt: 'DESC' },
      });
      return rows.map(toLeadActivityResponse);
    } catch (error) {
      throw new DatabaseError(error);
    }
  }
}
