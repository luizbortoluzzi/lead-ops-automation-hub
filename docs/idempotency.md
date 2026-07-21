# Idempotency

Phase 3 makes `POST /api/v1/leads/upsert` idempotent so that a retried or
duplicated request never duplicates effects.

## Contract

- Header **`Idempotency-Key`** is **required** on the upsert (GET endpoints do
  not use it).
- Validation: non-empty, trimmed, ≤ 255 chars, no control characters. Missing →
  `400 IDEMPOTENCY_KEY_REQUIRED`; malformed → `400 INVALID_IDEMPOTENCY_KEY`.
- The key is stored with a **unique constraint**; it is never used as a primary
  key and never logged verbatim.

## Canonical request hash

For each request the backend computes a **SHA-256 of a canonical object** built
only from accepted, normalized fields:

1. validate the DTO;
2. normalize (e-mail lowercased/trimmed, source lowercased);
3. build a canonical object with **only** accepted fields (`name`, `email`,
   `employees`, and present `externalId`/`phone`/`company`/`source`);
4. sort keys recursively and serialize deterministically;
5. SHA-256.

The hash therefore ignores: JSON key order, whitespace, the correlation id, the
idempotency key, and client-sent `score`/`segment` (which the backend recomputes
and never trusts). See
[canonical-hash.service.ts](../backend/src/common/hashing/canonical-hash.service.ts)
and `buildCanonicalLead` in
[upsert-lead.dto.ts](../backend/src/modules/leads/dto/upsert-lead.dto.ts).

## Decision flow

```text
Request
   │
Key exists?
 ├── no ──▶ atomic claim (INSERT … ON CONFLICT DO NOTHING) → PROCESSING
 │            └─ execute upsert → persist status+body → COMPLETED
 └── yes
       ├── COMPLETED + same hash  → REPLAY (return persisted response)
       ├── COMPLETED + diff hash  → CONFLICT (409)
       ├── PROCESSING             → IN_PROGRESS (409, retryable)
       └── FAILED + same hash     → re-claim → execute (retry)
           FAILED + diff hash     → CONFLICT (409)
```

## Concurrency strategy

Claiming a key is a single atomic statement:

```sql
INSERT INTO processed_requests (idempotency_key, request_hash, operation, status, correlation_id, expires_at)
VALUES ($1, $2, $3, 'PROCESSING', $4, now() + make_interval(days => $5))
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

- If a row is returned, **this** request owns the key → it executes the upsert.
- If nothing is returned, a concurrent request already claimed it → we `SELECT`
  the row and return REPLAY / CONFLICT / IN_PROGRESS accordingly.
- A `FAILED` record can be re-claimed via a guarded
  `UPDATE … WHERE id=$1 AND status='FAILED' RETURNING id` (only one winner).

There is **no** unguarded "SELECT then INSERT". Two simultaneous identical
requests cannot both create a lead — verified by an integration test that fires
`Promise.all([...])` with the same key against a real database
([idempotency.e2e.spec.ts](../backend/tests/integration/idempotency.e2e.spec.ts)).
The upsert itself also runs in a transaction.

## Responses

### Replay (same key + same payload)

The **original** status is preserved (e.g. `201` if the first call created the
lead) and the persisted body is returned, plus:

```http
Idempotency-Replayed: true
X-Original-Correlation-Id: <correlation id of the first request>
```

The upsert is **not** re-executed.

### Conflict (same key + different payload)

```http
409 Conflict
```

```json
{ "error": { "code": "IDEMPOTENCY_CONFLICT", "message": "The idempotency key was already used with a different request", "details": [] } }
```

### In progress (same key, still processing)

We return **`409 Conflict`** (not 425) — simpler for the HTTP client, and n8n
treats `error.code = IDEMPOTENCY_IN_PROGRESS` as **retryable**:

```json
{ "error": { "code": "IDEMPOTENCY_IN_PROGRESS", "message": "A request with this idempotency key is already being processed", "details": [] } }
```

### Failed

`markFailed` stores `last_error_code`/`last_error_message` (sanitized, bounded).
Policy: a failure **before** a proven business effect leaves a `FAILED` record
that a same-payload retry can re-claim. We never assume "failed with no effect"
when that cannot be proven — a completed upsert is recorded `COMPLETED` before
the response, so a crash after completion still replays rather than re-runs.

## What is persisted

`response_status_code`, `response_body` (JSONB), `completed_at`, `status`,
`operation`, `request_hash`, `correlation_id`, `expires_at`. **Never**: API keys,
Authorization, cookies, stack traces.

## Expiration

`expires_at = created_at + IDEMPOTENCY_RETENTION_DAYS` (default 7). It documents
when a key *could* be recycled; **no automatic cleanup runs in Phase 3**. A
future cleanup could delete `COMPLETED`/`FAILED` rows past `expires_at` (a cron
or a manual `DELETE`). Until then keys are retained indefinitely. After a
hypothetical expiry+cleanup, the same key would be treated as new.

## cURL

```bash
# first request → 201, Idempotency-Replayed: false
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" -H "X-API-Key: change-me-development-key" \
  -H "Idempotency-Key: landing-page-123" -d @samples/idempotent-request.json

# repeat exactly → 201, Idempotency-Replayed: true (no re-execution)
# same key, different body → 409 IDEMPOTENCY_CONFLICT
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" -H "X-API-Key: change-me-development-key" \
  -H "Idempotency-Key: landing-page-123" -d @samples/idempotency-conflict.json
```
