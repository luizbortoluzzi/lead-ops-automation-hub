import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { InvalidUuidError } from '../errors/app-error';
import { ZodValidationPipe } from '../errors/zod-validation.pipe';
import {
  CreateLeadInput,
  ListLeadsQuery,
  createLeadSchema,
  listLeadsQuerySchema,
  normalizeEmail,
} from '../schemas/lead.schema';
import { LeadResponse } from './lead.entity';
import { LeadsService, PaginatedLeads } from './leads.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput,
  ): Promise<LeadResponse> {
    return this.leads.create(body);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ): Promise<PaginatedLeads> {
    return this.leads.list(query);
  }

  // Declared before ":id" for readability; Fastify's router prioritizes the
  // static "by-email" segment over the ":id" param regardless of order.
  @Get('by-email/:email')
  findByEmail(@Param('email') email: string): Promise<LeadResponse> {
    return this.leads.findByEmail(normalizeEmail(decodeURIComponent(email)));
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<LeadResponse> {
    if (!UUID_REGEX.test(id)) {
      throw new InvalidUuidError();
    }
    return this.leads.findById(id);
  }
}
