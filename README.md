# LeadOps Automation Hub

> **Phase 2.** A modular lead-intake automation: n8n orchestrates reusable
> sub-workflows that call a NestJS + TypeORM backend (the source of truth) over
> an authenticated API, with correlation-id tracing, an activity audit trail, and
> local e-mail notifications via Mailpit.

## Objective

Receive inbound leads over HTTP, normalize and pre-validate them in n8n, then let
the **backend** definitively validate, **score/segment**, and persist them —
authenticating service-to-service with an API key, tracing each run with a
correlation id, recording an audit trail, and notifying sales about `enterprise`
leads through Mailpit.

## Business problem

Inbound leads arrive from many channels in inconsistent shapes. Phase 2 makes the
pipeline **modular and trustworthy**: business rules live in one tested backend
(not scattered across automation nodes), calls are authenticated, every run is
traceable, and high-value leads trigger a sales notification — without any real
e-mail being sent in development.

## Architecture

```text
Client ──POST /webhook/lead──▶ n8n WF01 Lead Intake
                                 │  ensure correlation id
                                 ▼
                          WF02 Normalize Lead ──(invalid)──▶ Respond 400
                                 │ valid
                                 ▼
                          WF03 Backend Upsert ──▶ POST /api/v1/leads/upsert
                                 │                 (X-API-Key, X-Correlation-Id)
                                 │                 backend recomputes score/segment,
                                 │                 upserts in a transaction
                                 ▼
                          WF04 Register Activity (AUTOMATION_PROCESSED)
                                 ▼
                          Switch on segment
                            ├─ small/medium ─▶ Respond
                            └─ enterprise ─▶ WF05 Notify Sales ─▶ Mailpit
                                              WF04 (ENTERPRISE_NOTIFICATION_SENT)
                                              ▶ Respond
```

n8n normalizes and pre-validates; **the backend is the source of truth**. Full
detail: [docs/architecture.md](docs/architecture.md).

## Stack

| Concern         | Choice                                         |
| --------------- | ---------------------------------------------- |
| API framework   | NestJS 11 on the **Fastify 5** adapter         |
| Frontend        | React 19 + Vite 6 + TypeScript + Tailwind 4    |
| Language        | TypeScript (strict)                            |
| Validation      | Zod (DTOs + inferred types)                    |
| ORM / Database  | TypeORM (migrations) on PostgreSQL 16          |
| Orchestration   | n8n (built manually, exported to `workflows/`) |
| Mail (local)    | Mailpit (SMTP capture + web UI)                |
| Containers      | Docker Compose                                 |
| Tests           | Vitest (`app.inject()`)                        |
| Lint / format   | ESLint (flat config) + Prettier                |

## Repository structure

```text
.
├── compose.yaml                 # postgres + backend + frontend + n8n + mailpit
├── Makefile                     # make demo / up / validate / check / test-int …
├── .env.example
├── docs/
│   ├── architecture.md
│   ├── phase-1-n8n-guide.md
│   ├── phase-2-n8n-guide.md      # build the WF01–WF05 workflows by hand
│   ├── api-authentication.md
│   └── correlation-id.md
├── workflows/                    # WF01–WF05 n8n scaffolds (import + wire by hand)
├── backend/
│   └── src/
│       ├── common/{auth,correlation,errors,filters,interceptors,pipes,validation}
│       ├── config/               # Zod-validated env
│       ├── database/             # TypeORM DataSource + migrations
│       └── modules/
│           ├── health/
│           └── leads/{controllers,dto,entities,enums,services,types}
├── frontend/                     # React + Vite + Tailwind SPA (nginx + /api proxy)
│   └── src/{lib,components}
└── samples/{valid,invalid,enterprise,update}-lead.json
```

## Prerequisites

- Docker + Docker Compose v2. GNU Make (optional, recommended).
- Node.js ≥ 20 + npm (only to run the backend/tests outside Docker).

## Quick start (Makefile)

```bash
make demo        # .env + build + up + wait healthy + validate end-to-end
make up          # build + start postgres, backend, frontend, n8n, mailpit
make validate    # live check: health, auth, upsert, correlation id, activities
make urls        # print backend / n8n / mailpit URLs
make check       # typecheck + lint + unit tests
make test-int    # unit + integration tests against the running Postgres
make logs        # tail all logs
make clean       # stop and wipe volumes
```

`make` reads host ports and the API key from `.env`, so `make validate` targets
the right port and sends the right key automatically.

## Configure `.env`

```bash
cp .env.example .env    # or: make env
```

| Variable                   | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `POSTGRES_DB/USER/PASSWORD`| Postgres container credentials                     |
| `POSTGRES_PORT`            | Host port mapped to Postgres                        |
| `BACKEND_PORT`             | Host port for the backend API                       |
| `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | How the backend connects to Postgres  |
| `BACKEND_API_KEY`          | Shared secret for `X-API-Key` (n8n → backend)       |
| `N8N_PORT`                 | Host port for n8n                                   |
| `MAILPIT_SMTP_PORT/WEB_PORT` | Mailpit SMTP + web UI host ports                  |
| `SMTP_HOST/PORT/FROM`, `SALES_NOTIFICATION_EMAIL` | Mail settings used by n8n |
| `TZ`                       | Timezone (`America/Sao_Paulo`)                      |

`.env` is git-ignored — never commit real secrets.

## Migrations

The schema is owned by **TypeORM migrations**
([backend/src/database/migrations/](backend/src/database/migrations/)); the
backend runs pending migrations on startup (`migrationsRun: true`,
`synchronize: false`). To manage them by hand:

```bash
cd backend
npm run migration:run        # apply pending (DATABASE_* / DATABASE_URL must point at your DB)
npm run migration:revert     # roll back the last one
npm run migration:generate -- src/database/migrations/<Name>   # diff entities → new migration
npm run migration:create -- src/database/migrations/<Name>     # empty migration
# or, against the running compose DB:  make migrate
```

## Run & access

```bash
make up      # or: docker compose up --build -d
make urls
```

- **Frontend / Dashboard**: `http://localhost:${FRONTEND_PORT}` — a React/Vite/
  Tailwind SPA (served by nginx, which reverse-proxies `/api` and `/health` to
  the backend, so the browser is same-origin — no CORS). Upsert leads, browse the
  paginated list, and view/add activities. Paste your `BACKEND_API_KEY` once (kept
  in the browser's `localStorage`); it is never baked into the bundle.
- **Backend** (API only): `http://localhost:${BACKEND_PORT}` (waits for Postgres healthy, runs migrations)
- **n8n**: `http://localhost:${N8N_PORT}`
- **Mailpit**: `http://localhost:${MAILPIT_WEB_PORT}` (captured e-mails)

Logs: `make logs` / `docker compose logs -f backend`. Stop: `make down` (keep
data) or `make clean` (wipe volumes).

## n8n credentials & workflows

1. **Credentials** (create once in n8n — never hardcoded):
   - `LeadOps Backend API` — **Header Auth**, header `X-API-Key`, value = `BACKEND_API_KEY`.
   - `Mailpit SMTP` — host `mailpit`, port `1025`, no TLS/auth.
2. **Workflows**: build them by hand following
   [docs/phase-2-n8n-guide.md](docs/phase-2-n8n-guide.md). The `workflows/*.json`
   files are importable **scaffolds** — after importing, select the credentials
   and set each Execute Workflow node's sub-workflow reference (the guide lists
   exact inputs). The backend URL inside n8n is always `http://backend:3000`.

Full auth details: [docs/api-authentication.md](docs/api-authentication.md).
Tracing: [docs/correlation-id.md](docs/correlation-id.md).

## API endpoints

Base: `http://localhost:${BACKEND_PORT}`. All `/api/v1/**` require `X-API-Key`.

| Method | Path                          | Auth | Description                          |
| ------ | ----------------------------- | :--: | ------------------------------------ |
| GET    | `/health`                     |  —   | Liveness + DB connectivity           |
| POST   | `/api/v1/leads/upsert`        |  ✔   | Create (201) or update (200) a lead  |
| POST   | `/api/v1/leads/:id/activities`|  ✔   | Record a lead activity (201)         |
| GET    | `/api/v1/leads/:id/activities`|  ✔   | List a lead's activities (newest first) |
| GET    | `/api/v1/leads/:id`           |  ✔   | Get a lead by UUID                   |
| GET    | `/api/v1/leads/by-email/:email`| ✔   | Get a lead by e-mail (case-insens.)  |
| GET    | `/api/v1/leads?page=1&limit=20`| ✔   | List leads, newest first             |

Success envelope: `{ "data": … }` (upsert also returns `{ "meta": { "operation": "created|updated" } }`).
Error envelope: `{ "error": { "code": "…", "message": "…", "details": [] } }`.

Codes: `VALIDATION_ERROR` (400), `INVALID_UUID` (400), `UNAUTHORIZED` (401),
`LEAD_NOT_FOUND` (404), `LEAD_ALREADY_EXISTS` (409), `LEAD_IDENTITY_CONFLICT`
(409), `DATABASE_ERROR` (500), `INTERNAL_ERROR` (500).

## cURL examples

Create/update a lead (score & segment are computed by the backend; any you send
are ignored):

```bash
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me-development-key" \
  -H "X-Correlation-Id: f667f28d-e592-465f-aa7c-07d46218d245" \
  -d @samples/valid-lead.json
```

Record an activity (replace `LEAD_UUID`):

```bash
curl -i -X POST http://localhost:3000/api/v1/leads/LEAD_UUID/activities \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me-development-key" \
  -H "X-Correlation-Id: f667f28d-e592-465f-aa7c-07d46218d245" \
  -d '{"type":"AUTOMATION_PROCESSED","description":"Lead processed by n8n","metadata":{"workflow":"WF01"}}'
```

Without an API key → `401`:

```bash
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" -d '{}'
```

The response always echoes `X-Correlation-Id` (the one you sent, or a generated
UUID).

## Tests

```bash
cd backend && npm install
npm run typecheck && npm run lint
npm test                                   # unit only (integration auto-skips)
# integration (needs Postgres) — or use `make test-int`:
TEST_DATABASE_URL=postgresql://leadops:change-me@localhost:5432/leadops npm test
```

Coverage includes the 15+ `LeadScoringService` cases and 17 HTTP integration
cases (upsert create/update, case-insensitive e-mail, externalId identity,
identity conflict 409, ignored client score/segment, API-key 401/allow, public
health, correlation id echo/generate, activity create/list/404/400).

Frontend:

```bash
cd frontend && npm install
npm run typecheck && npm run lint && npm run build   # or: make fe-build / make fe-lint
npm run dev        # Vite dev server; proxies /api to the backend (make fe-dev)
```

## Verify notifications

Send an `enterprise` lead through the n8n workflow (or trigger WF05), then open
Mailpit at `http://localhost:${MAILPIT_WEB_PORT}` — the notification appears
there. No real e-mail is sent.

## Technical decisions

- **Backend is the source of truth**: definitive validation, scoring, segment,
  persistence, uniqueness, transactions, auth, audit. n8n only orchestrates and
  pre-validates.
- **Score/segment computed server-side** by a pure, tested `LeadScoringService`;
  inbound `score`/`segment` are stripped and ignored.
- **Upsert identity**: externalId (partial unique index) preferred, else
  case-insensitive e-mail; lookup + write in one transaction; contradictory
  identity → `LEAD_IDENTITY_CONFLICT` (409).
- **API-key guard** global with `@Public()` for `/health`; constant-time compare;
  key never logged.
- **Correlation id** received-or-generated, logged, returned, and stored on
  activities.
- **TypeORM migrations** (`synchronize: false`); **Zod DTOs**; **fail-fast config**;
  **graceful shutdown**.

## Limitations (Phase 2)

- Notifications are best-effort (no retry); only `enterprise` is notified.
- The API key is a single shared secret (no per-client scoping / rate limiting).
- `workflows/*.json` are scaffolds — credentials and sub-workflow references are
  wired by hand after import.

## Not yet implemented (later phases)

- Idempotency keys · automatic retry · backoff · global n8n error workflow /
  dead-letter queue · CSV import · scheduled sync · daily reports · AI enrichment.

## Next phases

1. **Reliability**: idempotency, retry/backoff, global error workflow + DLQ.
2. **Ingestion**: CSV import, scheduled sync.
3. **Insight**: reporting & segmentation analytics.
4. **Hardening**: per-client API keys, rate limiting.
5. **Intelligence**: AI-assisted enrichment.

---

**Phase 2 status**: backend (upsert, scoring, auth, correlation, activities),
Mailpit, migrations, tests, docs and workflow scaffolds are implemented. Next
step: build the workflows by hand with
[docs/phase-2-n8n-guide.md](docs/phase-2-n8n-guide.md).
