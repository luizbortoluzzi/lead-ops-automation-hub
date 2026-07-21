import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { assertUuid } from '../../../common/validation/uuid';
import { ListLeadsQuery, listLeadsQuerySchema } from '../dto/list-leads.dto';
import { normalizeEmail, UpsertLeadDto, upsertLeadSchema } from '../dto/upsert-lead.dto';
import { LeadResponse } from '../types/lead-response';
import { LeadsService, PaginatedLeads } from '../services/leads.service';

@Controller('api/v1/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** Create-or-update a lead. Returns 201 when created, 200 when updated. */
  @Post('upsert')
  async upsert(
    @Body(new ZodValidationPipe(upsertLeadSchema)) body: UpsertLeadDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: LeadResponse; meta: { operation: string } }> {
    const { lead, operation } = await this.leads.upsert(body);
    void reply.status(operation === 'created' ? 201 : 200);
    return { data: lead, meta: { operation } };
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ): Promise<PaginatedLeads> {
    return this.leads.list(query);
  }

  @Get('by-email/:email')
  async findByEmail(@Param('email') email: string): Promise<{ data: LeadResponse }> {
    const data = await this.leads.findByEmail(normalizeEmail(decodeURIComponent(email)));
    return { data };
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<{ data: LeadResponse }> {
    assertUuid(id);
    const data = await this.leads.findById(id);
    return { data };
  }
}
