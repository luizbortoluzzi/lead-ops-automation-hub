import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DatabaseError, LeadAlreadyExistsError, LeadNotFoundError } from '../errors/app-error';
import { CreateLeadInput, ListLeadsQuery, normalizeEmail } from '../schemas/lead.schema';
import { Lead, LeadResponse, toLeadResponse } from './lead.entity';

/** PostgreSQL unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

export interface PaginatedLeads {
  data: LeadResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNextPage: boolean;
  };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
  ) {}

  async create(input: CreateLeadInput): Promise<LeadResponse> {
    // Re-normalize defensively, independent of the validation layer.
    const email = normalizeEmail(input.email);

    const lead = this.leads.create({
      externalId: input.externalId ?? null,
      name: input.name,
      email,
      phone: input.phone ?? null,
      company: input.company ?? null,
      employees: input.employees,
      source: input.source ?? null,
      score: input.score,
      segment: input.segment,
    });

    try {
      const saved = await this.leads.save(lead);
      return toLeadResponse(saved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new LeadAlreadyExistsError();
      }
      throw new DatabaseError(error);
    }
  }

  async findById(id: string): Promise<LeadResponse> {
    const lead = await this.runQuery(() => this.leads.findOne({ where: { id } }));
    if (!lead) {
      throw new LeadNotFoundError();
    }
    return toLeadResponse(lead);
  }

  async findByEmail(email: string): Promise<LeadResponse> {
    // Match on lower(email) so the functional unique index is used and the
    // lookup is case-insensitive regardless of stored casing.
    const lead = await this.runQuery(() =>
      this.leads
        .createQueryBuilder('lead')
        .where('lower(lead.email) = lower(:email)', { email: normalizeEmail(email) })
        .getOne(),
    );
    if (!lead) {
      throw new LeadNotFoundError();
    }
    return toLeadResponse(lead);
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
      pagination: {
        page,
        limit,
        total,
        hasNextPage: page * limit < total,
      },
    };
  }

  /** Wraps read queries so unexpected database failures map to DATABASE_ERROR. */
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
