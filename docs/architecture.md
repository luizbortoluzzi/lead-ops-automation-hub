# Architecture — Phase 2

## Purpose

LeadOps Automation Hub ingests inbound leads, qualifies them with deterministic
rules, persists them, and notifies sales about high-value (enterprise) leads.
Phase 2 turns the single service into a **modular integration**: n8n orchestrates
sub-workflows, the backend owns all business rules, and services authenticate to
each other with an API key while a correlation id makes each run traceable.

## Request flow

```text
Client
  │  POST /webhook/lead
  ▼
n8n · WF01 Lead Intake
  │  extract headers/body → ensure correlation id
  ▼
WF02 Normalize Lead (sub-workflow)      basic normalization + cheap validation
  │
  ├── invalid ─▶ Respond 400
  ▼ valid
WF03 Backend Lead Upsert (sub-workflow)
  │   POST http://backend:3000/api/v1/leads/upsert   (X-API-Key, X-Correlation-Id)
  │        ▼
  │     Backend: validate DTO → normalize → recompute score+segment
  │        → upsert in a transaction → 201 created / 200 updated
  ▼
WF04 Register Lead Activity (AUTOMATION_PROCESSED)
  │   POST /api/v1/leads/:id/activities
  ▼
Switch — segment
  ├── small / medium ─▶ Respond (no alert)
  └── enterprise
        ▼
      WF05 Notify Sales ─▶ Mailpit SMTP (mailpit:1025)
        ▼
      WF04 Register Lead Activity (ENTERPRISE_NOTIFICATION_SENT)
        ▼
      Respond 201/200
```

## Responsibility split

| Concern                         | n8n | Backend |
| ------------------------------- | :-: | :-----: |
| Receive external events         |  ✔  |         |
| Extract headers/body            |  ✔  |         |
| Initial normalization           |  ✔  |         |
| Cheap "don't bother" validation |  ✔  |         |
| Orchestration / routing         |  ✔  |         |
| Sub-workflows                   |  ✔  |         |
| Send notifications (SMTP)       |  ✔  |         |
| **Definitive DTO validation**   |     |    ✔    |
| **Defensive normalization**     |     |    ✔    |
| **Business rules**              |     |    ✔    |
| **Score & segment (final)**     |     |    ✔    |
| **Persistence / uniqueness**    |     |    ✔    |
| **Transactions**                |     |    ✔    |
| **AuthN / AuthZ**               |     |    ✔    |
| **Audit / activities**          |     |    ✔    |
| **Standardized errors**         |     |    ✔    |

The backend is the **source of truth**. n8n may transform and pre-validate to
avoid pointless calls, but the backend re-validates everything and never trusts
inbound `score`/`segment`.

## Why score/segment live in the backend

- **Determinism & consistency**: one implementation
  ([lead-scoring.service.ts](../backend/src/modules/leads/services/lead-scoring.service.ts)),
  unit-tested, applied identically no matter which caller (n8n, cURL, a future
  CSV importer) creates the lead.
- **Trust boundary**: a client could send any `score`; accepting it would let
  callers self-promote to `enterprise`. The DTO strips those fields and the
  backend recomputes.
- **Change safety**: scoring rules change often; keeping them in one tested
  service (not scattered across n8n Code nodes) makes changes safe and reviewable.

## Why sub-workflows

- **Reuse**: `WF03` (upsert) and `WF04` (activity) are called from multiple
  points; `WF02`/`WF05` isolate normalization and notification.
- **Testability & clarity**: each sub-workflow has a small, documented
  input/output contract and can be run in isolation.
- **Separation of concerns**: WF01 orchestrates; the others each do one job.

## Authentication between services

API key over `X-API-Key`, enforced by a global NestJS guard, `/health` public.
Full details: [api-authentication.md](api-authentication.md).

## Correlation ID

Received or generated per request, added to every log line, returned on the
response header, and stored on lead activities. Full details:
[correlation-id.md](correlation-id.md).

## Activity log

`lead_activities` is an append-only audit trail (one lead → many activities).
Initial types: `AUTOMATION_PROCESSED`, `ENTERPRISE_NOTIFICATION_SENT`,
`AUTOMATION_NOTIFICATION_FAILED` (enforced by a CHECK constraint). Each row keeps
`metadata` (JSONB) and `correlation_id`.

## Backend internal design

NestJS on the Fastify adapter, TypeORM, Zod for DTOs.

```text
src/
├── app.ts / server.ts        # createApp() + bootstrap (kept from Phase 1 for app.inject() tests)
├── app.module.ts             # wires global guard + logging interceptor + correlation middleware
├── common/
│   ├── auth/                 # ApiKeyGuard, @Public(), constants
│   ├── correlation/          # middleware, @CorrelationId() decorator, sanitizer
│   ├── errors/               # AppError hierarchy + codes
│   ├── filters/              # all-exceptions filter (stable envelope)
│   ├── interceptors/         # request logging
│   ├── pipes/                # Zod validation pipe
│   └── validation/           # UUID helper
├── config/                   # Zod-validated env (fail fast)
├── database/                 # TypeORM DataSource + migrations (run on startup)
└── modules/
    ├── health/               # public DB-aware health check
    └── leads/
        ├── controllers/      # leads.controller, lead-activities.controller
        ├── dto/              # Zod schemas (upsert, activity, list)
        ├── entities/         # Lead, LeadActivity
        ├── enums/            # segment, activity type (+ DB CHECK mirror)
        ├── services/         # leads.service (upsert/tx), lead-scoring, lead-activities
        └── types/            # response DTOs + mappers
```

### Key decisions

- **NestJS on Fastify** for `app.inject()` in-process tests.
- **Zod** as DTO validation + type inference (one schema validates and types).
- **TypeORM with migrations** (`synchronize: false`, `migrationsRun: true`).
- **Upsert identity**: externalId (partial unique index) preferred, else
  case-insensitive e-mail; the lookup + write run in one transaction; a payload
  whose externalId and e-mail point at two different leads → `LEAD_IDENTITY_CONFLICT`.
- **Global API-key guard** + `@Public()`; **correlation middleware**; **request
  logging interceptor** — all cross-cutting concerns live in `common/`.
- **Fail-fast config** and **graceful shutdown** (TypeORM pool closed on
  SIGTERM/SIGINT via `enableShutdownHooks`).

## Error model

One envelope for every error:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

| Code                     | HTTP | Raised when                                   |
| ------------------------ | ---- | --------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | Body/query fails Zod validation               |
| `INVALID_UUID`           | 400  | Path param is not a UUID                       |
| `UNAUTHORIZED`           | 401  | Missing/invalid API key                        |
| `LEAD_NOT_FOUND`         | 404  | Lead lookup returns nothing                    |
| `LEAD_ALREADY_EXISTS`    | 409  | Unique violation (`23505`)                     |
| `LEAD_IDENTITY_CONFLICT` | 409  | externalId and e-mail point at different leads |
| `DATABASE_ERROR`         | 500  | Unexpected database failure                    |
| `INTERNAL_ERROR`         | 500  | Any other unhandled error                      |

## Phase 3 — Resilience (idempotency, retry, failure handling)

Phase 3 makes the pipeline **idempotent, resilient, observable and
reprocessable**. New error codes: `IDEMPOTENCY_KEY_REQUIRED`,
`INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_CONFLICT` (409),
`IDEMPOTENCY_IN_PROGRESS` (409), plus simulated `RATE_LIMITED` (429),
`SERVICE_UNAVAILABLE` (503), `GATEWAY_TIMEOUT` (504).

### Idempotency (backend-owned)

- `POST /api/v1/leads/upsert` requires an `Idempotency-Key` header.
- The backend computes a **canonical SHA-256** of the accepted, normalized fields
  (order/whitespace/correlation-id/idempotency-key/score/segment independent).
- Claiming a key is **atomic** (`INSERT … ON CONFLICT DO NOTHING RETURNING`);
  concurrent identical requests cannot both write. Same key + same payload →
  replay the persisted response (original status, `Idempotency-Replayed: true`);
  same key + different payload → `409`. Ledger: `processed_requests`.
- Full detail: [idempotency.md](idempotency.md).

### Retry & backoff (n8n-owned)

WF06 retries only temporary failures (`408/425/429/500/502/503/504`, network
timeout, `IDEMPOTENCY_IN_PROGRESS`), never `400/401/403/404/IDEMPOTENCY_CONFLICT`.
Fixed backoff 2s/5s/15s, **max 4 attempts**, honoring `Retry-After`. Same
correlation id + idempotency key across attempts. See [retry-policy.md](retry-policy.md).

### Failure handling

WF99 (Error Trigger) classifies, sanitizes and persists definitive failures to
`automation_failures`, then alerts `operations@example.local` via Mailpit **only**
on definitive failures. Secondary (notification) failures never revert the
primary upsert; the response reports `meta.notification.status`. A failed
enterprise notification is reprocessable via WF07 **without re-running the
upsert**. See [failure-handling.md](failure-handling.md) and
[reprocessing.md](reprocessing.md).

### Failure simulation (dev/test only)

`X-Simulate-Error` (`rate-limit`/`server-error`/`service-unavailable`/`timeout`/
`bad-request`) forces controlled failures to exercise retry. Gated by
`ENABLE_FAILURE_SIMULATION` and **always inert in production**.

## Phase 3 limitations

Not implemented (later phases): CSV import, batch processing, scheduled sync,
daily reports, AI, a distributed queue / real dead-letter queue, and horizontal
scale. Idempotency records are retained (no automatic cleanup yet); backoff is
fixed (no jitter); reprocessing is manual; the API key is a single shared secret.
