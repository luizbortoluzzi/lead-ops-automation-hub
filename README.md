# LeadOps Automation Hub

> **Phase 1 — MVP.** Local infrastructure, PostgreSQL, and a Backend API that a
> hand-built n8n workflow consumes to ingest, score, and persist leads.

## Objective

Provide a small, realistic automation backbone for **inbound lead processing**:
receive a lead over HTTP, normalize and validate it, compute a deterministic
**score** and **segment**, persist it to a CRM-like store, and answer the caller.
Phase 1 ships the runnable infrastructure and API; the orchestration is built by
hand in n8n as a learning exercise.

## Business problem

Inbound leads arrive from many channels (landing pages, referrals, CSV imports)
in inconsistent shapes. Sales teams waste time on unqualified leads and on manual
data entry. This project automates the boring, error-prone middle: clean the
data, qualify it with transparent rules, and file it consistently — so humans
only touch leads that are worth their time.

## Architecture (textual)

```text
HTTP client
    ↓
n8n Webhook
    ↓
Normalization + Validation      (n8n Code nodes)
    ↓
Scoring + Segmentation          (n8n Code + Switch)
    ↓
Backend API   ── Zod validation ──▶  PostgreSQL
    ↓
HTTP response (201 / 400 / 409)
```

- **n8n** owns orchestration and the frequently-changing business rules (scoring,
  segmentation).
- **Backend API** owns data integrity: it re-validates every payload with Zod,
  re-normalizes the e-mail, and persists via TypeORM (parameterized queries).
- **PostgreSQL** enforces the final constraints (non-negative numbers, allowed
  segments, case-insensitive unique e-mail).

Full detail: [docs/architecture.md](docs/architecture.md).

## Stack

| Concern         | Choice                                   |
| --------------- | ---------------------------------------- |
| API framework   | NestJS 11 on the **Fastify 5** adapter   |
| Language        | TypeScript (strict)                      |
| Validation      | Zod                                      |
| ORM / Database  | TypeORM (migrations) on PostgreSQL 16    |
| Orchestration   | n8n (built manually)                     |
| Containers      | Docker Compose                           |
| Tests           | Vitest (`app.inject()`)                  |
| Lint / format   | ESLint (flat config) + Prettier          |

## Repository structure

```text
.
├── README.md
├── compose.yaml                 # n8n + PostgreSQL + Backend
├── .env.example
├── docs/
│   ├── architecture.md
│   └── phase-1-n8n-guide.md      # build the n8n workflow by hand
├── backend/                     # NestJS + Fastify + TypeORM API
│   ├── Dockerfile
│   ├── src/{app,server}.ts, config/, schemas/, leads/, health/, errors/
│   ├── src/database/            # TypeORM DataSource + migrations/
│   └── tests/{unit,integration}/
└── samples/
    ├── valid-lead.json
    └── invalid-lead.json
```

## Prerequisites

- Docker + Docker Compose v2 (for the full stack).
- Node.js ≥ 20 and npm (only if you want to run the API/tests outside Docker).
- GNU Make (optional, but the shortcuts below assume it).

## Quick start (Makefile)

A `Makefile` is the single entry point — run `make` to list every target.

```bash
make demo        # create .env, build + start the stack, wait healthy, validate end-to-end
make up          # build + start everything (detached)
make validate    # live check: health + all endpoints + migration (stack must be up)
make check       # typecheck + lint + unit tests (CI-like gate)
make test-int    # unit + integration tests against the running Postgres
make logs        # tail all logs
make clean       # stop and wipe volumes
```

`make` reads host ports/credentials from your `.env`, so `make validate` targets
the right port automatically. The sections below show the underlying commands.

## Configure `.env`

```bash
cp .env.example .env
# then edit .env as needed
```

Variables (defaults are local-only example values):

| Variable            | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `POSTGRES_DB`       | Database name                                  |
| `POSTGRES_USER`     | Database user                                  |
| `POSTGRES_PASSWORD` | Database password                              |
| `POSTGRES_PORT`     | Host port mapped to Postgres                   |
| `BACKEND_PORT`     | Host port for the Backend API                 |
| `DATABASE_URL`      | Connection string used by the Backend         |
| `N8N_PORT`          | Host port for n8n                              |
| `TZ`                | Timezone (`America/Sao_Paulo`)                 |

The real `.env` is git-ignored. Never commit secrets.

## Run the stack

```bash
docker compose up --build -d
```

This starts:

- **PostgreSQL** on `localhost:${POSTGRES_PORT}` — has a health check.
- **Backend API** on `http://localhost:${BACKEND_PORT}` — waits for Postgres to
  be healthy, then starts, runs pending **TypeORM migrations** automatically, and
  exposes its own health check.
- **n8n** on `http://localhost:${N8N_PORT}`.

Check status:

```bash
docker compose ps
```

## Logs

```bash
docker compose logs -f backend      # API logs
docker compose logs -f postgres      # database logs
docker compose logs -f n8n           # n8n logs
docker compose logs -f               # everything
```

## Stop

```bash
docker compose down                  # stop containers, keep data volumes
docker compose down -v               # also remove volumes (wipes DB + n8n data)
```

## Tests

The Backend has **unit tests** (no external services) and **integration tests**
(require PostgreSQL). Integration tests skip themselves automatically when no
database URL is set.

```bash
cd backend
npm install

npm run typecheck        # strict TS, no emit
npm run lint             # ESLint
npm test                 # unit tests (+ integration if a DB URL is present)

# Run integration tests against the compose database:
TEST_DATABASE_URL=postgresql://leadops:change-me@localhost:5432/leadops npm test
```

Other scripts: `npm run dev` (watch), `npm run build`, `npm start`,
`npm run test:watch`, `npm run format`.

## Database migrations (TypeORM)

The schema is owned by TypeORM migrations under
[backend/src/database/migrations/](backend/src/database/migrations/). The backend
runs pending migrations automatically on startup (`migrationsRun: true`), so
`docker compose up` is enough for a working schema. To manage them by hand:

```bash
cd backend
# DATABASE_URL must point at your database (see .env), e.g. localhost:5432
npm run migration:run                       # apply pending migrations
npm run migration:revert                    # roll back the last migration
npm run migration:generate -- src/database/migrations/<Name>   # diff entity → new migration
```

## Backend API endpoints

Base URL: `http://localhost:${BACKEND_PORT}` (default `http://localhost:3000`).

| Method | Path                          | Description                              | Success |
| ------ | ----------------------------- | ---------------------------------------- | ------- |
| GET    | `/health`                     | Liveness + database connectivity         | `200`   |
| POST   | `/api/leads`                  | Create a lead                            | `201`   |
| GET    | `/api/leads/:id`              | Get a lead by UUID                       | `200`   |
| GET    | `/api/leads/by-email/:email`  | Get a lead by e-mail (case-insensitive)  | `200`   |
| GET    | `/api/leads?page=1&limit=20`  | List leads, newest first                 | `200`   |

Error responses share one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body", "details": [] } }
```

Codes: `VALIDATION_ERROR` (400), `INVALID_UUID` (400), `LEAD_NOT_FOUND` (404),
`LEAD_ALREADY_EXISTS` (409), `DATABASE_ERROR` (500), `INTERNAL_ERROR` (500).

## cURL examples

Health check:

```bash
curl -s http://localhost:3000/health
# {"status":"ok"}
```

Create a lead:

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d @samples/valid-lead.json
# HTTP/1.1 201 Created  → returns the created lead (note the "id")
```

Get by ID (replace `<id>` with the returned UUID):

```bash
curl -s http://localhost:3000/api/leads/<id>
```

Get by e-mail (case-insensitive):

```bash
curl -s http://localhost:3000/api/leads/by-email/MARIA@example.com
```

List leads (paginated):

```bash
curl -s "http://localhost:3000/api/leads?page=1&limit=20"
```

Invalid payload → `400`:

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d @samples/invalid-lead.json
```

Duplicate e-mail → `409` (run the create twice with the same e-mail):

```bash
curl -i -X POST http://localhost:3000/api/leads -H "Content-Type: application/json" -d @samples/valid-lead.json
curl -i -X POST http://localhost:3000/api/leads -H "Content-Type: application/json" -d @samples/valid-lead.json
# second call → HTTP/1.1 409 Conflict, error.code = LEAD_ALREADY_EXISTS
```

Invalid UUID → `400`:

```bash
curl -i http://localhost:3000/api/leads/not-a-uuid
# error.code = INVALID_UUID
```

## Build the n8n workflow

Phase 1 intentionally does **not** ship a ready-made workflow. Build it yourself,
step by step, following [docs/phase-1-n8n-guide.md](docs/phase-1-n8n-guide.md).
The guide includes exact node names, settings, expressions, the full JavaScript
for every Code node (including the scoring rules), the HTTP Request
configuration, how to test with the Webhook Test URL, and a validation checklist.

Lead scoring rules implemented in the guide:

- **Employees**: 1–10 → 10, 11–50 → 25, 51–200 → 50, 201+ → 70.
- **Source**: `referral`/`indication` +20, `landing-page` +10, `csv-import` +5,
  others +0.
- **Completeness**: phone present +5, company present +5.
- **Segment**: 0–29 → `small`, 30–69 → `medium`, 70+ → `enterprise`.

## Technical decisions

- **NestJS on Fastify** for a lean runtime and fast in-process HTTP tests via
  `app.inject()` (no sockets needed).
- **Zod** as the single source of truth for request shapes — it validates *and*
  provides the inferred TypeScript types; schemas are unit-tested in isolation.
- **TypeORM with migrations**: a `Lead` entity maps the table; the schema is
  owned by a migration that runs on startup (`migrationsRun`, `synchronize:
  false`). The repository API / query builder bind all parameters — no string
  concatenation into SQL.
- **Database as the integrity backstop**: a functional unique index on
  `lower(email)` guarantees case-insensitive uniqueness even under concurrent
  inserts; CHECK constraints guard non-negative numbers and the allowed segments.
- **Centralized error handling**: one `@Catch()` filter → one stable envelope;
  internals (stack traces, SQL) are logged, never returned.
- **Fail-fast config** validated with Zod at startup; **graceful shutdown** via
  `enableShutdownHooks()` closes the TypeORM connection on SIGTERM/SIGINT.

## Current limitations

- The backend persists to its own PostgreSQL — there is no sync to an external
  CRM yet (that would be a later phase).
- The n8n workflow is built manually and is not versioned in this repo.
- No authentication on the API or the webhook (local development only).
- The Switch node's segment branches all converge on the same action in Phase 1.

## Not yet implemented (deferred)

- Idempotency (dedupe by idempotency key).
- Retry with backoff.
- Global error workflow in n8n.
- CSV import.
- Scheduled synchronization.
- Reporting / analytics.
- API-key authentication.
- AI enrichment / integration.

## Next phases

1. **Reliability**: idempotency keys, retry/backoff, a global n8n error workflow.
2. **Ingestion**: CSV import and scheduled sync.
3. **Insight**: reporting and segmentation analytics.
4. **Hardening**: API-key auth, rate limiting.
5. **Intelligence**: AI-assisted enrichment and lead summaries.

---

**Phase 1 status**: infrastructure, database, and Backend API are implemented
and tested. Recommended next step: build the workflow in
[docs/phase-1-n8n-guide.md](docs/phase-1-n8n-guide.md).
```
