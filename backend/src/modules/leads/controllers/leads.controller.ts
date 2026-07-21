import { Body, Controller, Get, Headers, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { CorrelationId } from '../../../common/correlation/correlation-id.decorator';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../common/errors/app-error';
import { CanonicalHashService } from '../../../common/hashing/canonical-hash.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { FailureSimulationGuard } from '../../../common/simulation/failure-simulation.guard';
import { assertUuid } from '../../../common/validation/uuid';
import {
  IDEMPOTENCY_KEY_HEADER,
  validateIdempotencyKey,
} from '../../idempotency/idempotency.constants';
import { IdempotencyKeyGuard } from '../../idempotency/idempotency-key.guard';
import { IdempotencyService } from '../../idempotency/idempotency.service';
import { ListLeadsQuery, listLeadsQuerySchema } from '../dto/list-leads.dto';
import {
  buildCanonicalLead,
  normalizeEmail,
  UpsertLeadDto,
  upsertLeadSchema,
} from '../dto/upsert-lead.dto';
import { LeadResponse } from '../types/lead-response';
import { LeadsService, PaginatedLeads } from '../services/leads.service';

@Controller('api/v1/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly idempotency: IdempotencyService,
    private readonly hasher: CanonicalHashService,
  ) {}

  /**
   * Idempotent create-or-update. Requires an `Idempotency-Key` header. Same
   * key + same payload replays the persisted response (201/200 preserved);
   * same key + different payload → 409. Score/segment are backend-computed.
   */
  @Post('upsert')
  @UseGuards(FailureSimulationGuard, IdempotencyKeyGuard)
  async upsert(
    @Headers(IDEMPOTENCY_KEY_HEADER) rawKey: string | undefined,
    @Body(new ZodValidationPipe(upsertLeadSchema)) body: UpsertLeadDto,
    @CorrelationId() correlationId: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const validation = validateIdempotencyKey(rawKey);
    if (!validation.valid) {
      throw validation.reason === 'missing'
        ? new IdempotencyKeyRequiredError()
        : new InvalidIdempotencyKeyError();
    }

    const requestHash = this.hasher.hash(buildCanonicalLead(body));

    const outcome = await this.idempotency.execute(
      {
        key: validation.value,
        requestHash,
        operation: 'LEAD_UPSERT',
        correlationId: correlationId ?? null,
      },
      async () => {
        const { lead, operation } = await this.leads.upsert(body);
        return {
          statusCode: operation === 'created' ? 201 : 200,
          body: { data: lead, meta: { operation, idempotencyReplayed: false } },
        };
      },
    );

    void reply.status(outcome.statusCode);
    void reply.header('Idempotency-Replayed', String(outcome.replayed));
    if (outcome.replayed && outcome.originalCorrelationId) {
      void reply.header('X-Original-Correlation-Id', outcome.originalCorrelationId);
    }
    return outcome.body;
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
