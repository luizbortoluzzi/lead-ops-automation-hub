import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const API_KEY = 'test-secret-key';
const auth = { 'x-api-key': API_KEY };

const lead = {
  externalId: 'idem-1',
  name: 'Maria Silva',
  email: 'maria@example.com',
  employees: 40,
  source: 'landing-page',
};

describeIfDb('Idempotency & failure simulation (e2e)', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
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

  const upsert = (payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/leads/upsert',
      headers: { ...auth, ...headers },
      payload: payload as object,
    });

  // --- key validation -------------------------------------------------------

  it('rejects an upsert without Idempotency-Key (400)', async () => {
    const res = await upsert(lead);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects an invalid Idempotency-Key (400)', async () => {
    const res = await upsert(lead, { 'idempotency-key': 'x'.repeat(300) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  // --- replay / conflict ----------------------------------------------------

  it('replays the original response for the same key + payload', async () => {
    const key = { 'idempotency-key': 'k-replay' };
    const first = await upsert(lead, { ...key, 'x-correlation-id': 'cid-original' });
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotency-replayed']).toBe('false');
    const firstId = first.json().data.id;

    const second = await upsert(lead, { ...key, 'x-correlation-id': 'cid-different' });
    expect(second.statusCode).toBe(201); // original status preserved
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.headers['x-original-correlation-id']).toBe('cid-original');
    expect(second.json().data.id).toBe(firstId);

    const leads = await dataSource.query('SELECT count(*)::int AS c FROM leads');
    expect(leads[0].c).toBe(1); // not re-created
  });

  it('returns 409 for the same key + a different payload', async () => {
    const key = { 'idempotency-key': 'k-conflict' };
    await upsert(lead, key);
    const res = await upsert({ ...lead, name: 'Different', email: 'other@example.com' }, key);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('hashes independently of key order / correlation id / ignored fields', async () => {
    const key = { 'idempotency-key': 'k-hash' };
    await upsert(lead, { ...key, 'x-correlation-id': 'c1' });
    // Same logical payload, different key order + ignored score/segment + different cid
    const reordered = {
      source: 'landing-page',
      employees: 40,
      email: 'maria@example.com',
      name: 'Maria Silva',
      externalId: 'idem-1',
      score: 999,
      segment: 'enterprise',
    };
    const res = await upsert(reordered, { ...key, 'x-correlation-id': 'c2' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotency-replayed']).toBe('true'); // treated as replay, not conflict
  });

  // --- concurrency ----------------------------------------------------------

  it('does not duplicate the lead under concurrent identical requests', async () => {
    const key = { 'idempotency-key': 'k-concurrent' };
    const responses = await Promise.all(Array.from({ length: 6 }, () => upsert(lead, key)));

    const leads = await dataSource.query('SELECT count(*)::int AS c FROM leads');
    expect(leads[0].c).toBe(1); // exactly one lead

    // Exactly one response actually performed the write (replayed=false, 2xx).
    const performed = responses.filter(
      (r) => r.statusCode < 400 && r.headers['idempotency-replayed'] === 'false',
    );
    expect(performed).toHaveLength(1);
    // Every response is a success replay or an in-progress conflict.
    for (const r of responses) {
      expect([200, 201, 409]).toContain(r.statusCode);
    }
    const pr = await dataSource.query(
      "SELECT status, response_status_code AS s FROM processed_requests WHERE idempotency_key='k-concurrent'",
    );
    expect(pr[0].status).toBe('COMPLETED');
    expect(pr[0].s).toBe(201);
  });

  it('persists the response body and status code in processed_requests', async () => {
    await upsert(lead, { 'idempotency-key': 'k-persist' });
    const rows = await dataSource.query(
      "SELECT status, response_status_code AS s, response_body AS b FROM processed_requests WHERE idempotency_key='k-persist'",
    );
    expect(rows[0].status).toBe('COMPLETED');
    expect(rows[0].s).toBe(201);
    expect(rows[0].b.data.email).toBe('maria@example.com');
  });

  // --- failure simulation ---------------------------------------------------

  it('simulates rate-limit → 429 with Retry-After', async () => {
    const res = await upsert(lead, { 'idempotency-key': 'k-rl', 'x-simulate-error': 'rate-limit' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('simulates service-unavailable → 503', async () => {
    const res = await upsert(lead, {
      'idempotency-key': 'k-su',
      'x-simulate-error': 'service-unavailable',
    });
    expect(res.statusCode).toBe(503);
  });

  it('simulates server-error → 500', async () => {
    const res = await upsert(lead, {
      'idempotency-key': 'k-se',
      'x-simulate-error': 'server-error',
    });
    expect(res.statusCode).toBe(500);
  });

  it('simulates bad-request → 400', async () => {
    const res = await upsert(lead, {
      'idempotency-key': 'k-br',
      'x-simulate-error': 'bad-request',
    });
    expect(res.statusCode).toBe(400);
  });

  it('simulates timeout → delayed 504', async () => {
    const start = Date.now();
    const res = await upsert(lead, { 'idempotency-key': 'k-to', 'x-simulate-error': 'timeout' });
    expect(res.statusCode).toBe(504);
    expect(Date.now() - start).toBeGreaterThanOrEqual(180); // ~SIMULATED_TIMEOUT_DELAY_MS
  });

  it('does not create a processed_request when a simulated error fires first', async () => {
    await upsert(lead, { 'idempotency-key': 'k-nosim', 'x-simulate-error': 'server-error' });
    const rows = await dataSource.query(
      "SELECT count(*)::int AS c FROM processed_requests WHERE idempotency_key='k-nosim'",
    );
    expect(rows[0].c).toBe(0);
  });
});
