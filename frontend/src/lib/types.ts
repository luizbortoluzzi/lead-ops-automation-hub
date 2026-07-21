export type LeadSegment = 'small' | 'medium' | 'enterprise';

export type LeadActivityType =
  'AUTOMATION_PROCESSED' | 'ENTERPRISE_NOTIFICATION_SENT' | 'AUTOMATION_NOTIFICATION_FAILED';

export interface Lead {
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

export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  description: string;
  metadata: Record<string, unknown>;
  correlationId: string | null;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}

export interface UpsertLeadInput {
  externalId?: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  employees: number;
  source?: string;
}

export type UpsertOperation = 'created' | 'updated';
