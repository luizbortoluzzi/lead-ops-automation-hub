import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdempotencyOperation, ProcessedRequestStatus } from '../enums/processed-request.enums';

/**
 * Records one idempotent request keyed by its `Idempotency-Key`. The unique
 * constraint on `idempotency_key` is what makes claiming a key atomic; the
 * `request_hash` distinguishes a legitimate replay from a conflict.
 */
@Entity('processed_requests')
@Index('processed_requests_status_idx', ['status'])
@Index('processed_requests_created_at_idx', ['createdAt'])
@Index('processed_requests_expires_at_idx', ['expiresAt'])
export class ProcessedRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, unique: true })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ type: 'text' })
  operation!: IdempotencyOperation;

  @Column({ type: 'text' })
  status!: ProcessedRequestStatus;

  @Column({ name: 'response_status_code', type: 'int', nullable: true })
  responseStatusCode!: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody!: unknown;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
