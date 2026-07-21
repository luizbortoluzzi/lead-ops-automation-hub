import type { Lead, LeadActivity, Pagination, UpsertLeadInput, UpsertOperation } from './types';

/**
 * Same-origin API client. In production the frontend's nginx reverse-proxies
 * `/api` and `/health` to the backend; in dev, Vite's proxy does the same — so
 * relative URLs work in both and there is no CORS.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly correlationId: string | null,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  correlationId: string | null;
}

let apiKey = '';
export function setApiKey(key: string): void {
  apiKey = key;
}

function newCorrelationId(): string {
  return crypto.randomUUID();
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ raw: unknown; correlationId: string | null }> {
  const correlationId = newCorrelationId();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Correlation-Id': correlationId,
      ...(init.headers ?? {}),
    },
  });
  const returnedCid = res.headers.get('X-Correlation-Id') ?? correlationId;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const err = (body as { error?: { code?: string; details?: [] } } | null)?.error;
    throw new ApiError(
      err?.code ?? `HTTP_${res.status}`,
      res.status,
      returnedCid,
      err?.details ?? [],
    );
  }
  return { raw: body, correlationId: returnedCid };
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch('/health');
  return (await res.json()) as { status: string };
}

export async function listLeads(
  page: number,
  limit: number,
): Promise<ApiResult<{ leads: Lead[]; pagination: Pagination }>> {
  const { raw, correlationId } = await request(`/api/v1/leads?page=${page}&limit=${limit}`);
  const body = raw as { data: Lead[]; pagination: Pagination };
  return { data: { leads: body.data, pagination: body.pagination }, correlationId };
}

export async function upsertLead(
  input: UpsertLeadInput,
): Promise<ApiResult<{ lead: Lead; operation: UpsertOperation }>> {
  const { raw, correlationId } = await request('/api/v1/leads/upsert', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const body = raw as { data: Lead; meta: { operation: UpsertOperation } };
  return { data: { lead: body.data, operation: body.meta.operation }, correlationId };
}

export async function listActivities(leadId: string): Promise<ApiResult<LeadActivity[]>> {
  const { raw, correlationId } = await request(`/api/v1/leads/${leadId}/activities`);
  return { data: (raw as { data: LeadActivity[] }).data, correlationId };
}

export async function addActivity(
  leadId: string,
  input: { type: string; description: string; metadata?: Record<string, unknown> },
): Promise<ApiResult<LeadActivity>> {
  const { raw, correlationId } = await request(`/api/v1/leads/${leadId}/activities`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { data: (raw as { data: LeadActivity }).data, correlationId };
}
