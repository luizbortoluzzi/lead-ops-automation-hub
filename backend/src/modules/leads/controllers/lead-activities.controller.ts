import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CorrelationId } from '../../../common/correlation/correlation-id.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { assertUuid } from '../../../common/validation/uuid';
import { CreateActivityDto, createActivitySchema } from '../dto/create-activity.dto';
import { LeadActivitiesService } from '../services/lead-activities.service';
import { LeadActivityResponse } from '../types/lead-response';

@Controller('api/v1/leads/:id/activities')
export class LeadActivitiesController {
  constructor(private readonly activities: LeadActivitiesService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createActivitySchema)) body: CreateActivityDto,
    @CorrelationId() correlationId: string | undefined,
  ): Promise<{ data: LeadActivityResponse }> {
    assertUuid(id);
    const data = await this.activities.create(id, body, correlationId ?? null);
    return { data };
  }

  @Get()
  async list(@Param('id') id: string): Promise<{ data: LeadActivityResponse[] }> {
    assertUuid(id);
    const data = await this.activities.listForLead(id);
    return { data };
  }
}
