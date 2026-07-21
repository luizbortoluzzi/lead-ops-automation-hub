import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 schema changes:
 *  - a partial unique index on leads.external_id (identity for upserts);
 *  - the lead_activities audit table (FK to leads, controlled type, JSONB
 *    metadata, correlation id).
 * Incremental and idempotent; the Phase 1 InitialSchema migration is untouched.
 */
export class LeadActivities1721600000000 implements MigrationInterface {
  name = 'LeadActivities1721600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // external_id is a stable identity when provided — enforce uniqueness only
    // for non-null values so leads without one are still allowed.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_external_id_unique_idx
         ON leads (external_id) WHERE external_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS lead_activities (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id        uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        type           text NOT NULL,
        description    text NOT NULL,
        metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
        correlation_id text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT lead_activities_type_allowed CHECK (type IN (
          'AUTOMATION_PROCESSED',
          'ENTERPRISE_NOTIFICATION_SENT',
          'AUTOMATION_NOTIFICATION_FAILED'
        ))
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS lead_activities_lead_id_idx ON lead_activities (lead_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS lead_activities_created_at_idx ON lead_activities (created_at DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS lead_activities`);
    await queryRunner.query(`DROP INDEX IF EXISTS leads_external_id_unique_idx`);
  }
}
