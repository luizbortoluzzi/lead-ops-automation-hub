import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ErrorType } from '../../../common/errors/error-classification';
import { AutomationFailureStatus, AutomationOperation } from '../enums/automation-failure.enums';

/**
 * A definitive (post-retry) automation failure recorded by the n8n global error
 * handler (WF99) or by workflows on partial failures. Payloads are sanitized
 * before persistence — no secrets, headers, or stack traces.
 */
@Entity('automation_failures')
@Index('automation_failures_status_idx', ['status'])
@Index('automation_failures_correlation_id_idx', ['correlationId'])
@Index('automation_failures_created_at_idx', ['createdAt'])
export class AutomationFailure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @Column({ name: 'workflow_name', type: 'text' })
  workflowName!: string;

  @Column({ name: 'execution_id', type: 'text', nullable: true })
  executionId!: string | null;

  @Column({ name: 'node_name', type: 'text', nullable: true })
  nodeName!: string | null;

  @Column({ type: 'text' })
  operation!: AutomationOperation;

  @Column({ name: 'error_type', type: 'text' })
  errorType!: ErrorType;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'boolean', default: false })
  retryable!: boolean;

  @Column({ type: 'int', default: 1 })
  attempt!: number;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload!: unknown;

  @Column({ type: 'text', default: 'OPEN' })
  status!: AutomationFailureStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;
}
