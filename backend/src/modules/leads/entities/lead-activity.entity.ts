import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadActivityType } from '../enums/lead-activity-type.enum';
import { Lead } from './lead.entity';

/**
 * Append-only audit trail for actions taken on a lead (by the automation or the
 * backend). One lead has many activities.
 */
@Entity('lead_activities')
@Index('lead_activities_lead_id_idx', ['leadId'])
@Index('lead_activities_created_at_idx', ['createdAt'])
export class LeadActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @ManyToOne(() => Lead, (lead) => lead.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead?: Lead;

  @Column({ type: 'text' })
  type!: LeadActivityType;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
