import { LeadActivity } from '../entities/lead-activity.entity';
import { Lead } from '../entities/lead.entity';
import { LeadActivityType } from '../enums/lead-activity-type.enum';
import { LeadSegment } from '../enums/lead-segment.enum';

export type UpsertOperation = 'created' | 'updated';

/** Client-facing lead representation (dates serialized as ISO strings). */
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
  segment: LeadSegment;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityResponse {
  id: string;
  leadId: string;
  type: LeadActivityType;
  description: string;
  metadata: Record<string, unknown>;
  correlationId: string | null;
  createdAt: string;
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

export function toLeadActivityResponse(activity: LeadActivity): LeadActivityResponse {
  return {
    id: activity.id,
    leadId: activity.leadId,
    type: activity.type,
    description: activity.description,
    metadata: activity.metadata,
    correlationId: activity.correlationId,
    createdAt: activity.createdAt.toISOString(),
  };
}
