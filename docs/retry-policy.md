# Retry Policy (n8n → backend)

Retries live in the **n8n** layer (WF06 — Backend Request With Retry), never in
the backend. Because the upsert is idempotent (see [idempotency.md](idempotency.md)),
retrying the same request with the **same `Idempotency-Key`** is safe.

## Retryable vs non-retryable

| Result                                   | Type                    | Retry |
| ---------------------------------------- | ----------------------- | :---: |
| `408`                                    | TIMEOUT                 | yes   |
| `409` + `IDEMPOTENCY_IN_PROGRESS`        | CONFLICT (transient)    | yes   |
| `425`                                    | DEPENDENCY_UNAVAILABLE  | yes   |
| `429`                                    | RATE_LIMIT              | yes   |
| `500`                                    | INTERNAL                | yes   |
| `502` / `503`                            | DEPENDENCY_UNAVAILABLE  | yes   |
| `504` / network timeout                  | TIMEOUT                 | yes   |
| `400`                                    | VALIDATION              | no    |
| `401`                                    | AUTHENTICATION          | no    |
| `403`                                    | AUTHORIZATION           | no    |
| `404`                                    | NOT_FOUND               | no    |
| `409` + `IDEMPOTENCY_CONFLICT`           | CONFLICT                | no    |
| anything else                            | UNKNOWN                 | **no** (conservative) |

Classification is also implemented (and unit-tested) in the backend for reuse:
[error-classification.ts](../backend/src/common/errors/error-classification.ts).
When the status alone is ambiguous (409), classify by the body `error.code`.

## Backoff

Fixed, capped, no infinite loop. Maximum **4 total attempts**:

```text
attempt 1 → retryable failure → wait 2s
attempt 2 → retryable failure → wait 5s
attempt 3 → retryable failure → wait 15s
attempt 4 → failure           → persist a definitive AutomationFailure + alert
```

Configured in n8n (documented, not enforced by the backend):
`N8N_MAX_RETRY_ATTEMPTS=4`.

## Retry-After

When the response carries a `Retry-After` header (e.g. the simulated `429`
returns `Retry-After: 2`), prefer that value over the backoff table, clamped to a
sane local maximum (e.g. ≤ 30s) to avoid pathological waits.

## Timeout

Each backend call uses a request timeout (`N8N_BACKEND_REQUEST_TIMEOUT_MS=5000`).
A timeout is classified as retryable TIMEOUT. The `X-Simulate-Error: timeout`
control stalls the backend beyond this timeout for testing (see
[failure-handling.md](failure-handling.md)).

## Header preservation across attempts

Every attempt sends the **same** `X-Correlation-Id` and the **same**
`Idempotency-Key`, and increments an `attempt` counter. This is what makes retries
safe and traceable: the backend replays the original response instead of creating
duplicates.

## Why retry requires idempotency

Without idempotency, retrying a partially-applied write risks duplicates. With
the idempotency ledger, a retry either (a) replays the already-persisted response
or (b) re-claims a `FAILED` record and completes it — never a second lead.

## Limitations (Phase 3)

- Backoff is fixed (no jitter), attempts capped at 4.
- No distributed queue / dead-letter queue; a definitive failure is persisted as
  an `AutomationFailure` and (optionally) reprocessed manually.
- The retry policy is configured by hand in n8n; the values above are the
  intended defaults.
