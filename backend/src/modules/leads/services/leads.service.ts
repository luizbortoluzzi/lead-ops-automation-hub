import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  DatabaseError,
  LeadAlreadyExistsError,
  LeadIdentityConflictError,
  LeadNotFoundError,
} from '../../../common/errors/app-error';
import { ListLeadsQuery } from '../dto/list-leads.dto';
import { normalizeEmail, UpsertLeadDto } from '../dto/upsert-lead.dto';
import { Lead } from '../entities/lead.entity';
import { LeadResponse, toLeadResponse, UpsertOperation } from '../types/lead-response';
import { LeadScoringService } from './lead-scoring.service';

/** PostgreSQL unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

export interface UpsertResult {
  lead: LeadResponse;
  operation: UpsertOperation;
}

export interface PaginatedLeads {
  data: LeadResponse[];
  pagination: { page: number; limit: number; total: number; hasNextPage: boolean };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scoring: LeadScoringService,
  ) {}

  /**
   * Create or update a lead, identified by externalId (preferred) or e-mail.
   * Score and segment are always recomputed here — never trusted from input.
   * The lookup + write run in one transaction.
   */
  async upsert(input: UpsertLeadDto): Promise<UpsertResult> {
    const email = normalizeEmail(input.email);
    const { score, segment } = this.scoring.calculate({
      employees: input.employees,
      source: input.source ?? '',
      phone: input.phone,
      company: input.company,
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Lead);
        const existing = await this.resolveIdentity(repo, input.externalId, email);

        const values = {
          externalId: input.externalId ?? existing?.externalId ?? null,
          name: input.name,
          email,
          phone: input.phone ?? null,
          company: input.company ?? null,
          employees: input.employees,
          source: input.source ?? null,
          score,
          segment,
        };

        if (existing) {
          repo.merge(existing, values);
          const saved = await repo.save(existing);
          return { lead: toLeadResponse(saved), operation: 'updated' as const };
        }

        const created = await repo.save(repo.create(values));
        return { lead: toLeadResponse(created), operation: 'created' as const };
      });
    } catch (error) {
      if (error instanceof LeadIdentityConflictError) throw error;
      if (isUniqueViolation(error)) throw new LeadAlreadyExistsError();
      throw new DatabaseError(error);
    }
  }

  /**
   * Finds the lead this payload refers to. Throws when externalId and e-mail
   * point at two different existing leads.
   */
  private async resolveIdentity(
    repo: Repository<Lead>,
    externalId: string | undefined,
    email: string,
  ): Promise<Lead | null> {
    const byExternal = externalId ? await repo.findOne({ where: { externalId } }) : null;
    const byEmail = await repo
      .createQueryBuilder('lead')
      .where('lower(lead.email) = lower(:email)', { email })
      .getOne();

    if (byExternal && byEmail && byExternal.id !== byEmail.id) {
      throw new LeadIdentityConflictError();
    }
    return byExternal ?? byEmail;
  }

  async findById(id: string): Promise<LeadResponse> {
    const lead = await this.runQuery(() => this.leads.findOne({ where: { id } }));
    if (!lead) throw new LeadNotFoundError();
    return toLeadResponse(lead);
  }

  async findByEmail(email: string): Promise<LeadResponse> {
    const lead = await this.runQuery(() =>
      this.leads
        .createQueryBuilder('lead')
        .where('lower(lead.email) = lower(:email)', { email: normalizeEmail(email) })
        .getOne(),
    );
    if (!lead) throw new LeadNotFoundError();
    return toLeadResponse(lead);
  }

  /** Returns the raw entity or throws 404 — used by the activities module. */
  async getEntityOrThrow(id: string, manager?: EntityManager): Promise<Lead> {
    const repo = manager ? manager.getRepository(Lead) : this.leads;
    const lead = await this.runQuery(() => repo.findOne({ where: { id } }));
    if (!lead) throw new LeadNotFoundError();
    return lead;
  }

  async list(query: ListLeadsQuery): Promise<PaginatedLeads> {
    const { page, limit } = query;
    const [rows, total] = await this.runQuery(() =>
      this.leads.findAndCount({
        order: { createdAt: 'DESC' },
        take: limit,
        skip: (page - 1) * limit,
      }),
    );
    return {
      data: rows.map(toLeadResponse),
      pagination: { page, limit, total, hasNextPage: page * limit < total },
    };
  }

  private async runQuery<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new DatabaseError(error);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  const candidate =
    error instanceof QueryFailedError ? (error.driverError as { code?: unknown }) : error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'code' in candidate &&
    (candidate as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
