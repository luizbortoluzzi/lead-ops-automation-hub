import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../../config/env.schema';
import {
  AppError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
} from '../../common/errors/app-error';
import { SanitizerService } from '../../common/sanitization/sanitizer.service';
import { IdempotencyOperation } from './enums/processed-request.enums';

interface ExistingRow {
  id: string;
  requestHash: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  responseStatusCode: number | null;
  responseBody: unknown;
  correlationId: string | null;
}

type Decision =
  | { type: 'NEW'; processedRequestId: string }
  | {
      type: 'REPLAY';
      statusCode: number;
      responseBody: unknown;
      originalCorrelationId: string | null;
    }
  | { type: 'IN_PROGRESS'; correlationId: string | null }
  | { type: 'CONFLICT' };

export interface IdempotentWorkResult {
  statusCode: number;
  body: unknown;
}

export interface IdempotencyOutcome {
  statusCode: number;
  body: unknown;
  replayed: boolean;
  originalCorrelationId: string | null;
}

export interface IdempotencyParams {
  key: string;
  requestHash: string;
  operation: IdempotencyOperation;
  correlationId: string | null;
}

/**
 * Enforces idempotency for write operations. Claiming a key is atomic
 * (`INSERT ... ON CONFLICT DO NOTHING`), so two concurrent requests with the
 * same key cannot both proceed. See docs/idempotency.md.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sanitizer: SanitizerService,
  ) {}

  /**
   * Runs `work` at most once per (key, hash). Returns the persisted response on
   * replay; throws conflict/in-progress errors otherwise. On a NEW request that
   * fails, the record is marked FAILED (a later retry with the same payload may
   * claim it again).
   */
  async execute(
    params: IdempotencyParams,
    work: () => Promise<IdempotentWorkResult>,
  ): Promise<IdempotencyOutcome> {
    const decision = await this.claim(params);

    switch (decision.type) {
      case 'REPLAY':
        return {
          statusCode: decision.statusCode,
          body: decision.responseBody,
          replayed: true,
          originalCorrelationId: decision.originalCorrelationId,
        };
      case 'CONFLICT':
        throw new IdempotencyConflictError();
      case 'IN_PROGRESS':
        throw new IdempotencyInProgressError();
      case 'NEW': {
        try {
          const result = await work();
          await this.complete(decision.processedRequestId, result);
          return {
            statusCode: result.statusCode,
            body: result.body,
            replayed: false,
            originalCorrelationId: null,
          };
        } catch (error) {
          await this.markFailed(decision.processedRequestId, error);
          throw error;
        }
      }
    }
  }

  /** Atomically claims the key, or resolves what to do with an existing record. */
  private async claim(params: IdempotencyParams): Promise<Decision> {
    const inserted: { id: string }[] = await this.dataSource.query(
      `INSERT INTO processed_requests
         (idempotency_key, request_hash, operation, status, correlation_id, expires_at)
       VALUES ($1, $2, $3, 'PROCESSING', $4, now() + make_interval(days => $5))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        params.key,
        params.requestHash,
        params.operation,
        params.correlationId,
        this.config.idempotencyRetentionDays,
      ],
    );
    if (inserted.length > 0) {
      return { type: 'NEW', processedRequestId: inserted[0].id };
    }

    const existing = await this.findByKey(params.key);
    if (!existing) {
      // Extremely rare race: the conflicting row vanished. Treat as in-progress.
      return { type: 'IN_PROGRESS', correlationId: null };
    }
    return this.decide(existing, params);
  }

  private async decide(row: ExistingRow, params: IdempotencyParams): Promise<Decision> {
    if (row.status === 'COMPLETED') {
      return row.requestHash === params.requestHash
        ? {
            type: 'REPLAY',
            statusCode: row.responseStatusCode ?? 200,
            responseBody: row.responseBody,
            originalCorrelationId: row.correlationId,
          }
        : { type: 'CONFLICT' };
    }
    if (row.status === 'PROCESSING') {
      return { type: 'IN_PROGRESS', correlationId: row.correlationId };
    }
    // FAILED — a same-payload retry may re-claim it; a different payload conflicts.
    if (row.requestHash !== params.requestHash) {
      return { type: 'CONFLICT' };
    }
    const reclaimed: { id: string }[] = await this.dataSource.query(
      `UPDATE processed_requests
         SET status='PROCESSING', correlation_id=$2, updated_at=now(),
             last_error_code=NULL, last_error_message=NULL
       WHERE id=$1 AND status='FAILED'
       RETURNING id`,
      [row.id, params.correlationId],
    );
    if (reclaimed.length > 0) {
      return { type: 'NEW', processedRequestId: row.id };
    }
    // Someone else re-claimed it first — re-read and decide.
    const again = await this.findByKey(params.key);
    if (again && again.status === 'COMPLETED') {
      return again.requestHash === params.requestHash
        ? {
            type: 'REPLAY',
            statusCode: again.responseStatusCode ?? 200,
            responseBody: again.responseBody,
            originalCorrelationId: again.correlationId,
          }
        : { type: 'CONFLICT' };
    }
    return { type: 'IN_PROGRESS', correlationId: again?.correlationId ?? null };
  }

  private async findByKey(key: string): Promise<ExistingRow | null> {
    const rows: ExistingRow[] = await this.dataSource.query(
      `SELECT id,
              request_hash AS "requestHash",
              status,
              response_status_code AS "responseStatusCode",
              response_body AS "responseBody",
              correlation_id AS "correlationId"
       FROM processed_requests WHERE idempotency_key = $1`,
      [key],
    );
    return rows[0] ?? null;
  }

  private async complete(id: string, result: IdempotentWorkResult): Promise<void> {
    await this.dataSource.query(
      `UPDATE processed_requests
         SET status='COMPLETED', response_status_code=$2, response_body=$3::jsonb,
             completed_at=now(), updated_at=now()
       WHERE id=$1`,
      [id, result.statusCode, JSON.stringify(result.body ?? null)],
    );
  }

  private async markFailed(id: string, error: unknown): Promise<void> {
    const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    const message = this.sanitizer.sanitizeMessage(
      error instanceof Error ? error.message : String(error),
      500,
    );
    await this.dataSource.query(
      `UPDATE processed_requests
         SET status='FAILED', last_error_code=$2, last_error_message=$3, updated_at=now()
       WHERE id=$1`,
      [id, code.slice(0, 100), message],
    );
  }
}
