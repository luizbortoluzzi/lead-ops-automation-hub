import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

/**
 * End-to-end tests against a real PostgreSQL instance via `app.inject()`.
 * Skipped automatically when no database URL is provided.
 *   TEST_DATABASE_URL=postgresql://leadops:change-me@localhost:5432/leadops npm test
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const API_KEY = 'test-secret-key';
const auth = { 'x-api-key': API_KEY };

// employees 40 (25) + landing-page (10) + phone (5) + company (5) = 45 → medium
const validLead = {
  externalId: 'landing-page-123',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phone: '5511999998888',
  company: 'Acme Ltda',
  employees: 40,
  source: 'landing-page',
};

describeIfDb('LeadOps API v2 (e2e)', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.BACKEND_PORT = process.env.BACKEND_PORT ?? '3000';
    process.env.BACKEND_API_KEY = API_KEY;
    process.env.ENABLE_FAILURE_SIMULATION = 'true';
    process.env.SIMULATED_TIMEOUT_DELAY_MS = '200';

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

  // Each call gets a unique Idempotency-Key by default so it reaches the upsert
  // (idempotency behavior is covered in idempotency.e2e.spec.ts).
  let keySeq = 0;
  const upsert = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/leads/upsert',
      headers: { 'idempotency-key': `auto-${++keySeq}`, ...auth, ...headers },
      payload: payload as object,
    });

  // --- upsert create/update -------------------------------------------------

  it('creates a lead (201) and computes score/segment on the backend', async () => {
    const res = await upsert(validLead);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.meta.operation).toBe('created');
    expect(body.data.score).toBe(45); // 25 + 10 + 5 + 5
    expect(body.data.segment).toBe('medium');
  });

  it('updates the same lead on a second call (200)', async () => {
    const first = await upsert(validLead);
    const id = first.json().data.id;
    const res = await upsert({
      ...validLead,
      name: 'Maria Atualizada',
      employees: 220,
      source: 'referral',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.operation).toBe('updated');
    expect(body.data.id).toBe(id);
    expect(body.data.score).toBe(100); // 70 + 20 + 5 + 5
    expect(body.data.segment).toBe('enterprise');
  });

  it('treats e-mail case-insensitively when matching', async () => {
    const first = await upsert({ name: 'A', email: 'person@example.com', employees: 5 });
    const id = first.json().data.id;
    const res = await upsert({ name: 'A2', email: 'PERSON@Example.com', employees: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
  });

  it('locates an existing lead by externalId', async () => {
    const first = await upsert({
      externalId: 'ext-1',
      name: 'A',
      email: 'a@example.com',
      employees: 5,
    });
    const id = first.json().data.id;
    // same externalId, new e-mail not used elsewhere → updates the same lead
    const res = await upsert({
      externalId: 'ext-1',
      name: 'A',
      email: 'a-new@example.com',
      employees: 5,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(id);
    expect(res.json().data.email).toBe('a-new@example.com');
  });

  it('returns 409 when externalId and email reference different leads', async () => {
    await upsert({ externalId: 'ext-A', name: 'A', email: 'a@example.com', employees: 5 });
    await upsert({ externalId: 'ext-B', name: 'B', email: 'b@example.com', employees: 5 });
    const res = await upsert({
      externalId: 'ext-A',
      name: 'X',
      email: 'b@example.com',
      employees: 5,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LEAD_IDENTITY_CONFLICT');
  });

  it('ignores score and segment sent by the client', async () => {
    const res = await upsert({
      name: 'Small Co',
      email: 'small@example.com',
      employees: 5,
      score: 999,
      segment: 'enterprise',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.score).toBe(10);
    expect(res.json().data.segment).toBe('small');
  });

  // --- auth -----------------------------------------------------------------

  it('rejects requests without an API key (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leads/upsert',
      payload: validLead,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with an invalid API key (401)', async () => {
    const res = await upsert(validLead, { 'x-api-key': 'wrong' });
    expect(res.statusCode).toBe(401);
  });

  it('allows requests with a valid API key', async () => {
    const res = await upsert(validLead);
    expect(res.statusCode).toBe(201);
  });

  it('keeps /health public (no API key required)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  // --- correlation id -------------------------------------------------------

  it('returns the provided correlation id', async () => {
    const cid = 'f667f28d-e592-465f-aa7c-07d46218d245';
    const res = await upsert(validLead, { 'x-correlation-id': cid });
    expect(res.headers['x-correlation-id']).toBe(cid);
  });

  it('generates a correlation id when absent', async () => {
    const res = await upsert(validLead);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  // --- activities -----------------------------------------------------------

  it('records a lead activity (201) with the correlation id', async () => {
    const created = await upsert(validLead);
    const leadId = created.json().data.id;
    const cid = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadId}/activities`,
      headers: { ...auth, 'x-correlation-id': cid },
      payload: {
        type: 'AUTOMATION_PROCESSED',
        description: 'Lead processed by n8n',
        metadata: { workflow: 'WF01' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.leadId).toBe(leadId);
    expect(body.data.type).toBe('AUTOMATION_PROCESSED');
    expect(body.data.correlationId).toBe(cid);
    expect(body.data.metadata).toEqual({ workflow: 'WF01' });
  });

  it("lists a lead's activities (newest first)", async () => {
    const created = await upsert(validLead);
    const leadId = created.json().data.id;
    for (const type of ['AUTOMATION_PROCESSED', 'ENTERPRISE_NOTIFICATION_SENT']) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/leads/${leadId}/activities`,
        headers: auth,
        payload: { type, description: type },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId}/activities`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().data;
    expect(list).toHaveLength(2);
    expect(list[0].type).toBe('ENTERPRISE_NOTIFICATION_SENT'); // newest first
  });

  it('returns 404 when recording an activity for a missing lead', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leads/00000000-0000-0000-0000-000000000000/activities',
      headers: auth,
      payload: { type: 'AUTOMATION_PROCESSED', description: 'x' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('LEAD_NOT_FOUND');
  });

  it('returns 400 for an invalid activity type', async () => {
    const created = await upsert(validLead);
    const leadId = created.json().data.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadId}/activities`,
      headers: auth,
      payload: { type: 'NOT_A_TYPE', description: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an invalid lead UUID on activities', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/leads/not-a-uuid/activities',
      headers: auth,
      payload: { type: 'AUTOMATION_PROCESSED', description: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_UUID');
  });
});
