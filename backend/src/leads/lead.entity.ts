import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Segment } from '../schemas/lead.schema';

/**
 * TypeORM entity for the `leads` table. Column types are declared explicitly
 * (rather than inferred) so the mapping is unambiguous. Case-insensitive e-mail
 * uniqueness is enforced by a functional unique index created in the migration
 * (`lower(email)`), which decorators cannot express — e-mails are always stored
 * normalized (lowercased), so this is consistent.
 */
@Entity('leads')
@Index('leads_created_at_idx', ['createdAt'])
@Index('leads_segment_idx', ['segment'])
@Index('leads_external_id_idx', ['externalId'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  company!: string | null;

  @Column({ type: 'int', default: 0 })
  employees!: number;

  @Column({ type: 'text', nullable: true })
  source!: string | null;

  @Column({ type: 'int', default: 0 })
  score!: number;

  @Column({ type: 'text' })
  segment!: Segment;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** Client-facing representation (dates serialized as ISO strings). */
export interface LeadResponse {
  id: string;
  externalId: string | null;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  employees: number;
  source: string | null;
  score: number;
  segment: Segment;
  createdAt: string;
  updatedAt: string;
}

export function toLeadResponse(lead: Lead): LeadResponse {
  return {
    id: lead.id,
    externalId: lead.externalId,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    employees: lead.employees,
    source: lead.source,
    score: lead.score,
    segment: lead.segment,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}
