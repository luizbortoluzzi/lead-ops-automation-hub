import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadSegment } from '../enums/lead-segment.enum';
import { LeadActivity } from './lead-activity.entity';

/**
 * TypeORM entity for the `leads` table. Case-insensitive e-mail uniqueness is
 * enforced by a functional unique index on `lower(email)` (created in the
 * migration); e-mails are always stored normalized. `external_id` has a partial
 * unique index (when present) so it is a stable identity for upserts.
 */
@Entity('leads')
@Index('leads_created_at_idx', ['createdAt'])
@Index('leads_segment_idx', ['segment'])
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
  segment!: LeadSegment;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => LeadActivity, (activity) => activity.lead)
  activities?: LeadActivity[];
}
