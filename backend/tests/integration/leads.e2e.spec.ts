import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataSource } from 'typeorm';

/**
 * End-to-end tests that exercise the real Fastify app via `app.inject()`
 * against a real PostgreSQL instance. They are skipped automatically when no
 * database URL is provided (e.g. `npm test` on a machine without Docker).
 *
 * TypeORM applies its migration on startup, so no manual schema setup is needed.
 * Provide a URL via TEST_DATABASE_URL (preferred) or DATABASE_URL, e.g.:
 *   TEST_DATABASE_URL=postgresql://leadops:change-me@localhost:5432/leadops npm test
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const describeIfDb = databaseUrl ? describe : describe.skip;

const validPayload = {
  externalId: 'landing-page-123',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phone: '5511999998888',
  company: 'Acme Ltda',
  employees: 85,
  source: 'landing-page',
  score: 65,
  segment: 'medium',
};

describeIfDb('Leads API (e2e)', () => {
  let app: NestFastifyApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.BACKEND_PORT = process.env.BACKEND_PORT ?? '3000';

    // Import after env is set so config is loaded correctly.
    const { createApp } = await import('../../src/app');
    app = await createApp();
    await app.init(); // triggers TypeORM connection + migrationsRun

    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE leads');
  });

  it('GET /health returns ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('POST /api/leads creates a lead and returns 201', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/leads', payload: validPayload });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      externalId: 'landing-page-123',
      name: 'Maria Silva',
      email: 'maria@example.com',
      segment: 'medium',
      score: 65,
      employees: 85,
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.createdAt).toBeTypeOf('string');
  });

  it('POST /api/leads rejects an invalid payload with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: { name: '', email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('POST /api/leads rejects a duplicate e-mail with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/leads', payload: validPayload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: { ...validPayload, email: 'MARIA@example.com' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LEAD_ALREADY_EXISTS');
  });

  it('GET /api/leads/by-email/:email finds a lead case-insensitively', async () => {
    await app.inject({ method: 'POST', url: '/api/leads', payload: validPayload });
    const res = await app.inject({
      method: 'GET',
      url: '/api/leads/by-email/MARIA@Example.com',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe('maria@example.com');
  });

  it('GET /api/leads/by-email/:email returns 404 when missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leads/by-email/ghost@example.com',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('LEAD_NOT_FOUND');
  });

  it('GET /api/leads/:id returns 400 for an invalid UUID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_UUID');
  });

  it('GET /api/leads/:id returns 404 for an unknown UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leads/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('LEAD_NOT_FOUND');
  });

  it('GET /api/leads/:id returns the lead for a valid UUID', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: validPayload,
    });
    const { id } = created.json();
    const res = await app.inject({ method: 'GET', url: `/api/leads/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it('GET /api/leads paginates results ordered by created_at desc', async () => {
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/leads',
        payload: { ...validPayload, email: `lead${i}@example.com` },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/leads?page=1&limit=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toEqual({ page: 1, limit: 2, total: 3, hasNextPage: true });

    const page2 = await app.inject({ method: 'GET', url: '/api/leads?page=2&limit=2' });
    expect(page2.json().pagination).toEqual({ page: 2, limit: 2, total: 3, hasNextPage: false });
  });

  it('GET /api/leads returns an empty page when there are no leads', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leads' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, hasNextPage: false },
    });
  });
});
