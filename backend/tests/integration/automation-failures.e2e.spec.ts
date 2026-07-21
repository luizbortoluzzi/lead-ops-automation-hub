import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const API_KEY = 'test-secret-key';
const auth = { 'x-api-key': API_KEY };

const baseFailure = {
  correlationId: 'cid-fail-1',
  workflowName: 'WF01 — Lead Intake',
  executionId: '1234',
  nodeName: 'Backend Lead Upsert',
  operation: 'LEAD_UPSERT',
  errorType: 'RATE_LIMIT',
  errorCode: 'BACKEND_RATE_LIMIT',
  statusCode: 429,
  retryable: true,
  attempt: 4,
  message: 'Backend rate limit exceeded',
  payload: { source: 'landing-page' },
};

describeIfDb('AutomationFailures (e2e)', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.BACKEND_API_KEY = API_KEY;

    const { createApp } = await import('../../src/app');
    app = await createApp();
    await app.init();
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE processed_requests, automation_failures, lead_activities, leads CASCADE',
    );
  });

  const create = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/automation-failures',
      headers: auth,
      payload: payload as object,
    });

  it('requires an API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/automation-failures' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a failure (201)', async () => {
    const res = await create(baseFailure);
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.status).toBe('OPEN');
    expect(data.errorType).toBe('RATE_LIMIT');
    expect(data.correlationId).toBe('cid-fail-1');
  });

  it('sanitizes sensitive fields in the payload', async () => {
    const res = await create({
      ...baseFailure,
      payload: {
        source: 'landing-page',
        authorization: 'Bearer secret',
        apiKey: 'k-123',
        nested: { password: 'p', token: 't', keep: 'ok' },
      },
    });
    const payload = res.json().data.payload;
    expect(payload.authorization).toBe('[REDACTED]');
    expect(payload.apiKey).toBe('[REDACTED]');
    expect(payload.nested.password).toBe('[REDACTED]');
    expect(payload.nested.token).toBe('[REDACTED]');
    expect(payload.nested.keep).toBe('ok');
    expect(payload.source).toBe('landing-page');
  });

  it('lists failures with pagination and filters', async () => {
    await create(baseFailure);
    await create({ ...baseFailure, errorType: 'INTERNAL', correlationId: 'cid-other' });
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/automation-failures?page=1&limit=1',
      headers: auth,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().data).toHaveLength(1);
    expect(all.json().pagination.total).toBe(2);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/automation-failures?errorType=INTERNAL',
      headers: auth,
    });
    expect(filtered.json().pagination.total).toBe(1);
  });

  it('resolves a failure', async () => {
    const created = await create(baseFailure);
    const id = created.json().data.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automation-failures/${id}/resolve`,
      headers: auth,
      payload: { resolutionNote: 'Notification reprocessed successfully' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('RESOLVED');
    expect(res.json().data.resolvedAt).toBeTruthy();
    expect(res.json().data.resolutionNote).toBe('Notification reprocessed successfully');
  });

  it('returns 404 for an unknown failure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/automation-failures/00000000-0000-0000-0000-000000000000',
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUTOMATION_FAILURE_NOT_FOUND');
  });

  it('rejects an invalid errorType (400)', async () => {
    const res = await create({ ...baseFailure, errorType: 'NOPE' });
    expect(res.statusCode).toBe(400);
  });

  // --- partial failure semantics -------------------------------------------

  it('keeps the lead intact when a secondary (notification) failure is recorded', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/leads/upsert',
      headers: { ...auth, 'idempotency-key': 'pf-1' },
      payload: { name: 'Big', email: 'big@corp.com', employees: 220, source: 'referral' },
    });
    const leadId = created.json().data.id;

    // A notification failed → recorded as an automation failure. The lead stays.
    await create({
      ...baseFailure,
      operation: 'SEND_ENTERPRISE_NOTIFICATION',
      errorType: 'DEPENDENCY_UNAVAILABLE',
      payload: { leadId },
    });

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId}`,
      headers: auth,
    });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().data.id).toBe(leadId);
  });
});
