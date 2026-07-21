# Architecture — Phase 1 (MVP)

## Purpose

LeadOps Automation Hub ingests inbound leads (from landing pages, CSV imports,
referrals, etc.), scores and segments them, and persists them into a CRM-like
store. Phase 1 delivers the **local infrastructure** and the **Backend API**;
the orchestration itself is built manually in n8n following
[phase-1-n8n-guide.md](phase-1-n8n-guide.md).

## Request flow

```text
HTTP client
    │  POST /webhook/lead  (raw lead JSON)
    ▼
n8n Webhook
    │
    ▼
Normalization (Code / Edit Fields)  ── trim, lowercase e-mail, coerce types
    │
    ▼
Validation (Code)                   ── required fields, e-mail shape
    │
    ├── invalid ─▶ Respond to Webhook (HTTP 400)
    │
    ▼ valid
Scoring (Code)                      ── deterministic score from firmographics
    │
    ▼
Segmentation (Switch)               ── small / medium / enterprise
    │
    ▼
HTTP Request ─▶ Backend API
                    │  POST /api/leads
                    ▼
                Zod validation ─▶ 400 on bad body
                    │
                    ▼
                PostgreSQL (INSERT) ─▶ 409 on duplicate e-mail
                    │
                    ▼
                201 Created + lead JSON
    │
    ▼
Respond to Webhook (HTTP 201)
```

## Components

| Component      | Responsibility                                                        | Tech                              |
| -------------- | --------------------------------------------------------------------- | --------------------------------- |
| **n8n**        | Orchestration: webhook, normalization, validation, scoring, routing   | n8n (Docker), built by hand       |
| **Backend**   | Validate + persist leads, expose read endpoints                       | NestJS 11 + Fastify 5, Zod, TypeORM |
| **PostgreSQL** | Durable lead storage with constraints and indexes                     | PostgreSQL 16                     |

Where the work lives: n8n owns **scoring and segmentation** (business rules that
change often); the Backend owns **validation and persistence** (data integrity
that must always hold, regardless of caller). The Backend therefore re-validates
everything with Zod and re-normalizes the e-mail — it never trusts its caller.

## Backend internal design

NestJS on the Fastify adapter. Modules are thin and single-purpose:

```text
src/
├── app.ts                 # createApp(): builds the app, wires global filter + shutdown hooks
├── server.ts              # bootstrap(): validates config, listens on 0.0.0.0
├── app.module.ts          # root module
├── config/                # Zod-validated environment (fail fast at startup)
├── database/              # TypeORM DataSource config + migrations (run on startup)
├── schemas/               # Zod schemas (create body, list query) — the source of truth for shapes
├── leads/                 # controller (HTTP) + service (TypeORM repository) + entity ↔ DTO mapping
├── health/                # DB-aware health check
└── errors/                # AppError hierarchy + all-exceptions filter + Zod pipe
```

### Key decisions

- **NestJS on Fastify**, not Express: lighter runtime, and `app.inject()` gives
  fast in-process HTTP tests without opening a socket.
- **Zod, not class-validator**: one schema validates the HTTP body *and* infers
  the TypeScript type, and the same schemas are unit-tested in isolation.
- **TypeORM with migrations**: a `Lead` entity maps the table; the schema is
  owned by a TypeORM migration that runs on startup (`migrationsRun`), never by
  `synchronize`. Queries use the repository API / query builder with bound
  parameters — values are never concatenated into SQL.
- **Centralized errors**: a single `@Catch()` filter maps a small `AppError`
  hierarchy to a stable response envelope. Technical details (stack traces, SQL,
  the driver error) are logged server-side only.
- **Case-insensitive e-mail uniqueness** enforced by a functional `UNIQUE INDEX`
  on `lower(email)` — the database is the final arbiter, so concurrent inserts
  can't race past an application-level check.
- **Config validated at startup**: an invalid/missing env var stops the process
  immediately with a readable message instead of failing on first request.
- **Graceful shutdown**: `enableShutdownHooks()` lets TypeORM close its
  connection pool on SIGTERM/SIGINT.

## Error model

All errors share one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body", "details": [] } }
```

| Code                  | HTTP | Raised when                                  |
| --------------------- | ---- | -------------------------------------------- |
| `VALIDATION_ERROR`    | 400  | Body/query fails Zod validation              |
| `INVALID_UUID`        | 400  | `:id` path param is not a UUID               |
| `LEAD_NOT_FOUND`      | 404  | Lead lookup returns nothing                  |
| `LEAD_ALREADY_EXISTS` | 409  | Duplicate e-mail (unique-violation `23505`)  |
| `DATABASE_ERROR`      | 500  | Unexpected database failure                  |
| `INTERNAL_ERROR`      | 500  | Any other unhandled error                    |

## Data model

Single table `leads` (created by the TypeORM migration
[1721520000000-InitialSchema.ts](../backend/src/database/migrations/1721520000000-InitialSchema.ts)):
UUID primary key, `name`/`email` required, `employees`/`score` non-negative
(CHECK), `segment` constrained to `small | medium | enterprise`, `TIMESTAMPTZ`
timestamps (`created_at`/`updated_at` managed by TypeORM's
`@CreateDateColumn`/`@UpdateDateColumn`), a functional unique index on
`lower(email)`, and indexes on `created_at DESC`, `segment`, and `external_id`.

## Not in Phase 1

Idempotency keys, retry/backoff, a global n8n error workflow, CSV import,
scheduled sync, reporting, API-key auth, and AI enrichment are all deferred.
See the README's "Próximas fases".
```
