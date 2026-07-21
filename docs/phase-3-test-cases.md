# Phase 3 — Test Cases

Reproducible procedures to validate the resilient pipeline. Backend behaviors are
also covered automatically (`make test-int`); the n8n behaviors are manual.

Shared setup:

```bash
export B=http://localhost:3000            # or your local port, e.g. 3010
export K=change-me-development-key
```

## Backend (automated + cURL)

Run the automated suite (unit + integration incl. concurrency & simulation):

```bash
make test-int
```

### Workflow-logic smoke test

`scripts/wf-smoke-test.mjs` emulates the **WF06/WF01/WF07 logic** (identical
headers, classification and backoff) against the running backend — proving
replay, conflict (no retry), retry-with-backoff (4 attempts, same correlation id,
definitive failure persisted + sanitized) and reprocessing (no upsert, e-mail to
Mailpit, failure resolved, no duplicate lead). It is a harness that mirrors the
workflow code paths — it does **not** execute n8n itself.

```bash
make n8n-import      # import the pre-wired workflows into n8n (stable ids + WF99 error workflow)
make wf-smoke        # run the 17-check behavior harness (needs the stack up)
```

Manual cURL smoke tests:

| # | Case | Command / expectation |
| - | ---- | --------------------- |
| 1 | Missing key → 400 | `curl -si -XPOST $B/api/v1/leads/upsert -H "X-API-Key:$K" -H "Content-Type:application/json" -d @samples/idempotent-request.json` → `400 IDEMPOTENCY_KEY_REQUIRED` |
| 2 | First → 201 | add `-H "Idempotency-Key: t-1"` → `201`, `Idempotency-Replayed: false` |
| 3 | Replay → 201 replayed | repeat #2 exactly → `201`, `Idempotency-Replayed: true` |
| 4 | Conflict → 409 | same key `t-1`, body `@samples/idempotency-conflict.json` → `409 IDEMPOTENCY_CONFLICT` |
| 5 | Concurrency | fire 5 identical requests with one key in parallel → one lead only (see below) |
| 6 | Rate limit | `-H "Idempotency-Key: t-rl" -H "X-Simulate-Error: rate-limit"` → `429` + `Retry-After: 2` |
| 7 | 503 | `-H "X-Simulate-Error: service-unavailable"` → `503` |
| 8 | 500 | `-H "X-Simulate-Error: server-error"` → `500` |
| 9 | Timeout | `-H "X-Simulate-Error: timeout"` → delayed `504` |
| 10 | Prod block | with `NODE_ENV=production` the header is ignored (no simulation) |
| 11 | Failure CRUD | `POST/GET/PATCH /api/v1/automation-failures` (see samples) |
| 12 | Sanitization | POST a failure with `payload.authorization` → stored `[REDACTED]` |

Concurrency smoke test:

```bash
K=change-me-development-key B=http://localhost:3000
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/v1/leads/upsert \
    -H "Content-Type: application/json" -H "X-API-Key: $K" \
    -H "Idempotency-Key: concurrent-1" -d @samples/idempotent-request.json &
done; wait
# then verify exactly one lead:
docker compose exec -T postgres psql -U leadops -d leadops -tAc \
  "SELECT count(*) FROM leads WHERE email='maria@example.com';"   # → 1
```

## n8n (manual)

Trigger WF01 via its Test URL (`.../webhook-test/lead`) with an
`Idempotency-Key` header, and inspect executions.

| # | Case | How to verify |
| - | ---- | ------------- |
| 1 | `400` no retry | send `X-Simulate-Error: bad-request` → WF06 shows a single `Call Backend`, no `Wait` |
| 2 | `401` no retry | temporarily use a wrong API key credential → single attempt |
| 3 | `429` retries | `X-Simulate-Error: rate-limit` → WF06 loops, honoring `Retry-After` |
| 4 | `500` retries | `X-Simulate-Error: server-error` → WF06 loops |
| 5 | `503` retries | `X-Simulate-Error: service-unavailable` → WF06 loops |
| 6 | timeout retries | `X-Simulate-Error: timeout` (or lower the node timeout) → WF06 loops |
| 7 | stops after 4 | keep simulation on → exactly 4 `Call Backend` runs, then definitive failure |
| 8 | same correlation id | open each `Call Backend`: `X-Correlation-Id` identical every attempt |
| 9 | same idempotency key | open each `Call Backend`: `Idempotency-Key` identical every attempt |
| 10 | failure persisted | after 4 attempts → row in `automation_failures` (`GET /api/v1/automation-failures`) |
| 11 | alert only at end | Mailpit (`:8025`) shows **one** alert, not one per attempt |
| 12 | notification failure keeps lead | force WF05 to fail → lead still exists; response `meta.notification.status=failed` |
| 13 | reprocessing sends e-mail | run WF07 with the `failureId` → Mailpit shows the enterprise e-mail |
| 14 | reprocessing no upsert | during WF07, confirm no call to `/leads/upsert`; lead `updatedAt` unchanged |

## Inspecting state

```bash
# idempotency ledger
docker compose exec postgres psql -U leadops -d leadops -c \
  "SELECT idempotency_key, status, response_status_code FROM processed_requests ORDER BY created_at DESC LIMIT 10;"

# automation failures
docker compose exec postgres psql -U leadops -d leadops -c \
  "SELECT workflow_name, error_type, status, attempt FROM automation_failures ORDER BY created_at DESC LIMIT 10;"
```
