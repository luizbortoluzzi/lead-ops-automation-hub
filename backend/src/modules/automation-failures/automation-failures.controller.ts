import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CorrelationId } from '../../common/correlation/correlation-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { assertUuid } from '../../common/validation/uuid';
import {
  AutomationFailureResponse,
  AutomationFailuresService,
  PaginatedFailures,
} from './automation-failures.service';
import {
  CreateAutomationFailureDto,
  ListAutomationFailuresQuery,
  ResolveAutomationFailureDto,
  createAutomationFailureSchema,
  listAutomationFailuresQuerySchema,
  resolveAutomationFailureSchema,
} from './dto/automation-failure.dto';

@Controller('api/v1/automation-failures')
export class AutomationFailuresController {
  constructor(private readonly failures: AutomationFailuresService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createAutomationFailureSchema)) body: CreateAutomationFailureDto,
    @CorrelationId() correlationId: string | undefined,
  ): Promise<{ data: AutomationFailureResponse }> {
    const data = await this.failures.create(body, correlationId ?? null);
    return { data };
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(listAutomationFailuresQuerySchema))
    query: ListAutomationFailuresQuery,
  ): Promise<PaginatedFailures> {
    return this.failures.list(query);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<{ data: AutomationFailureResponse }> {
    assertUuid(id);
    const data = await this.failures.findById(id);
    return { data };
  }

  @Patch(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveAutomationFailureSchema)) body: ResolveAutomationFailureDto,
  ): Promise<{ data: AutomationFailureResponse }> {
    assertUuid(id);
    const data = await this.failures.resolve(id, body.resolutionNote ?? null);
    return { data };
  }

  @Patch(':id/reprocessing')
  async reprocessing(@Param('id') id: string): Promise<{ data: AutomationFailureResponse }> {
    assertUuid(id);
    const data = await this.failures.markReprocessing(id);
    return { data };
  }
}
