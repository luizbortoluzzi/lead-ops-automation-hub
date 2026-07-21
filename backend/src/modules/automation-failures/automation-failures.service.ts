import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationFailureNotFoundError, DatabaseError } from '../../common/errors/app-error';
import { SanitizerService } from '../../common/sanitization/sanitizer.service';
import {
  CreateAutomationFailureDto,
  ListAutomationFailuresQuery,
} from './dto/automation-failure.dto';
import { AutomationFailure } from './entities/automation-failure.entity';
import { AutomationFailureStatus } from './enums/automation-failure.enums';

export interface AutomationFailureResponse {
  id: string;
  correlationId: string | null;
  workflowName: string;
  executionId: string | null;
  nodeName: string | null;
  operation: string;
  errorType: string;
  errorCode: string | null;
  statusCode: number | null;
  retryable: boolean;
  attempt: number;
  message: string;
  payload: unknown;
  status: AutomationFailureStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface PaginatedFailures {
  data: AutomationFailureResponse[];
  pagination: { page: number; limit: number; total: number; hasNextPage: boolean };
}

@Injectable()
export class AutomationFailuresService {
  constructor(
    @InjectRepository(AutomationFailure)
    private readonly failures: Repository<AutomationFailure>,
    private readonly sanitizer: SanitizerService,
  ) {}

  async create(
    dto: CreateAutomationFailureDto,
    fallbackCorrelationId: string | null,
  ): Promise<AutomationFailureResponse> {
    try {
      const entity = this.failures.create({
        correlationId: dto.correlationId ?? fallbackCorrelationId,
        workflowName: dto.workflowName,
        executionId: dto.executionId ?? null,
        nodeName: dto.nodeName ?? null,
        operation: dto.operation,
        errorType: dto.errorType,
        errorCode: dto.errorCode ?? null,
        statusCode: dto.statusCode ?? null,
        retryable: dto.retryable,
        attempt: dto.attempt,
        message: this.sanitizer.sanitizeMessage(dto.message),
        payload: dto.payload === undefined ? null : this.sanitizer.sanitize(dto.payload),
        status: 'OPEN',
      });
      const saved = await this.failures.save(entity);
      return toResponse(saved);
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  async list(query: ListAutomationFailuresQuery): Promise<PaginatedFailures> {
    const { page, limit, status, errorType, correlationId } = query;
    const qb = this.failures.createQueryBuilder('f').orderBy('f.createdAt', 'DESC');
    if (status) qb.andWhere('f.status = :status', { status });
    if (errorType) qb.andWhere('f.errorType = :errorType', { errorType });
    if (correlationId) qb.andWhere('f.correlationId = :correlationId', { correlationId });

    try {
      const [rows, total] = await qb
        .take(limit)
        .skip((page - 1) * limit)
        .getManyAndCount();
      return {
        data: rows.map(toResponse),
        pagination: { page, limit, total, hasNextPage: page * limit < total },
      };
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  async findById(id: string): Promise<AutomationFailureResponse> {
    return toResponse(await this.getOrThrow(id));
  }

  async resolve(id: string, resolutionNote: string | null): Promise<AutomationFailureResponse> {
    const failure = await this.getOrThrow(id);
    failure.status = 'RESOLVED';
    failure.resolvedAt = new Date();
    failure.resolutionNote = resolutionNote
      ? this.sanitizer.sanitizeMessage(resolutionNote, 1000)
      : null;
    return toResponse(await this.save(failure));
  }

  async markReprocessing(id: string): Promise<AutomationFailureResponse> {
    const failure = await this.getOrThrow(id);
    failure.status = 'REPROCESSING';
    return toResponse(await this.save(failure));
  }

  private async getOrThrow(id: string): Promise<AutomationFailure> {
    let failure: AutomationFailure | null;
    try {
      failure = await this.failures.findOne({ where: { id } });
    } catch (error) {
      throw new DatabaseError(error);
    }
    if (!failure) throw new AutomationFailureNotFoundError();
    return failure;
  }

  private async save(failure: AutomationFailure): Promise<AutomationFailure> {
    try {
      return await this.failures.save(failure);
    } catch (error) {
      throw new DatabaseError(error);
    }
  }
}

function toResponse(f: AutomationFailure): AutomationFailureResponse {
  return {
    id: f.id,
    correlationId: f.correlationId,
    workflowName: f.workflowName,
    executionId: f.executionId,
    nodeName: f.nodeName,
    operation: f.operation,
    errorType: f.errorType,
    errorCode: f.errorCode,
    statusCode: f.statusCode,
    retryable: f.retryable,
    attempt: f.attempt,
    message: f.message,
    payload: f.payload,
    status: f.status,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
    resolutionNote: f.resolutionNote,
  };
}
