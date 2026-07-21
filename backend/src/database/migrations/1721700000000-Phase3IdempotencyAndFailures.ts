import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3: idempotency ledger (processed_requests) and the automation failure
 * log (automation_failures). Incremental and idempotent; earlier migrations are
 * untouched.
 */
export class Phase3IdempotencyAndFailures1721700000000 implements MigrationInterface {
  name = 'Phase3IdempotencyAndFailures1721700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS processed_requests (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key      varchar(255) NOT NULL,
        request_hash         text NOT NULL,
        operation            text NOT NULL,
        status               text NOT NULL,
        response_status_code integer,
        response_body        jsonb,
        correlation_id       text,
        last_error_code      varchar(100),
        last_error_message   text,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        completed_at         timestamptz,
        expires_at           timestamptz,
        CONSTRAINT processed_requests_status_allowed
          CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS processed_requests_key_unique_idx ON processed_requests (idempotency_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS processed_requests_status_idx ON processed_requests (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS processed_requests_created_at_idx ON processed_requests (created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS processed_requests_expires_at_idx ON processed_requests (expires_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS automation_failures (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        correlation_id  text,
        workflow_name   text NOT NULL,
        execution_id    text,
        node_name       text,
        operation       text NOT NULL,
        error_type      text NOT NULL,
        error_code      varchar(100),
        status_code     integer,
        retryable       boolean NOT NULL DEFAULT false,
        attempt         integer NOT NULL DEFAULT 1,
        message         text NOT NULL,
        payload         jsonb,
        status          text NOT NULL DEFAULT 'OPEN',
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        resolved_at     timestamptz,
        resolution_note text,
        CONSTRAINT automation_failures_status_allowed
          CHECK (status IN ('OPEN', 'REPROCESSING', 'RESOLVED', 'IGNORED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS automation_failures_status_idx ON automation_failures (status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS automation_failures_correlation_id_idx ON automation_failures (correlation_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS automation_failures_created_at_idx ON automation_failures (created_at DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS automation_failures`);
    await queryRunner.query(`DROP TABLE IF EXISTS processed_requests`);
  }
}
