import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `leads` table with its constraints and indexes. Runs
 * automatically on startup (`migrationsRun: true`) and via the TypeORM CLI.
 * Idempotent so it is safe against a database that already has the table.
 */
export class InitialSchema1721520000000 implements MigrationInterface {
  name = 'InitialSchema1721520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built-in from PostgreSQL 13+; pgcrypto is enabled
    // defensively so this also works on older engines.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        external_id text,
        name        text        NOT NULL,
        email       text        NOT NULL,
        phone       text,
        company     text,
        employees   integer     NOT NULL DEFAULT 0,
        source      text,
        score       integer     NOT NULL DEFAULT 0,
        segment     text        NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT leads_employees_non_negative CHECK (employees >= 0),
        CONSTRAINT leads_score_non_negative CHECK (score >= 0),
        CONSTRAINT leads_segment_allowed CHECK (segment IN ('small', 'medium', 'enterprise'))
      )
    `);

    // Case-insensitive uniqueness (also serves the "find by e-mail" lookup).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_email_lower_unique_idx ON leads (lower(email))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC)`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS leads_segment_idx ON leads (segment)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS leads_external_id_idx ON leads (external_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS leads`);
  }
}
