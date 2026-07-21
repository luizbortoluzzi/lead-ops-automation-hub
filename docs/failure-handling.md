# Failure Handling

## Global error workflow (WF99)

Every workflow points its **Error Workflow** setting at **WF99 — Global Error
Handler**, which uses an **Error Trigger**. On a definitive failure it:

```text
Error Trigger
  → Extract Error Context (correlationId, workflowName, executionId, nodeName,
                           operation, statusCode, errorCode, message, attempt)
  → Classify Error (errorType + retryable — see retry-policy.md)
  → Sanitize Payload
  → POST /api/v1/automation-failures  (persist)
  → Should Alert? ── yes ─▶ Send Email (Mailpit) to operations@example.local
                  └─ no  ─▶ finish
```

## Classification

Failures are classified into a fixed taxonomy: `VALIDATION`, `AUTHENTICATION`,
`AUTHORIZATION`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMIT`, `TIMEOUT`,
`DEPENDENCY_UNAVAILABLE`, `DATABASE`, `INTERNAL`, `UNKNOWN`
([error-classification.ts](../backend/src/common/errors/error-classification.ts)).

## Persistence — `automation_failures`

The backend exposes an authenticated CRUD for failures
([automation-failures](../backend/src/modules/automation-failures/)):

| Method | Path                                          | Purpose                    |
| ------ | --------------------------------------------- | -------------------------- |
| POST   | `/api/v1/automation-failures`                 | Record a definitive failure |
| GET    | `/api/v1/automation-failures`                 | List (status/errorType/correlationId + pagination) |
| GET    | `/api/v1/automation-failures/:id`             | Fetch one                  |
| PATCH  | `/api/v1/automation-failures/:id/resolve`     | Mark RESOLVED (+ note)     |
| PATCH  | `/api/v1/automation-failures/:id/reprocessing`| Mark REPROCESSING          |

States: `OPEN → REPROCESSING → RESOLVED` (or `IGNORED`).

## Sanitization

Payloads and messages are sanitized **before** persistence and logging by
[sanitizer.service.ts](../backend/src/common/sanitization/sanitizer.service.ts):
keys `authorization`, `x-api-key`, `apiKey`, `password`, `secret`, `token`,
`cookie`, `set-cookie` are redacted (case-insensitive, recursive), with depth,
array, string and key-count limits. It never throws on unexpected input. No API
keys, Authorization headers, or stack traces are stored.

## Alerts

Alert **only on a definitive failure** — never per intermediate attempt. Send an
e-mail (captured by Mailpit) to `operations@example.local` when:

- all retry attempts are exhausted;
- an authentication/configuration error occurs (won't self-heal);
- a persistent internal failure occurs;
- a secondary operation needs human intervention.

## Primary vs secondary operations — partial failures

- **Primary**: create/update the lead (the idempotent upsert).
- **Secondary**: send e-mail, register a notification activity, emit an alert.

A **secondary failure must not undo a completed primary operation**:

```text
Lead saved  ✅
  → e-mail failed ❌
Result: lead stays saved; AUTOMATION_PROCESSED stays recorded; the notification
        failure is persisted; the main response is still 200/201 with
        meta.notification.status = "failed" (+ failureId); it can be reprocessed.
```

The backend never deletes/reverts a lead because SMTP failed (verified by
[automation-failures.e2e.spec.ts](../backend/tests/integration/automation-failures.e2e.spec.ts)),
and reprocessing a notification never re-runs the upsert (see
[reprocessing.md](reprocessing.md)).

## Diagnosis

1. Grab the `X-Correlation-Id` from the caller/n8n execution.
2. `grep` it in the backend logs to see the request timeline.
3. `GET /api/v1/automation-failures?correlationId=<cid>` to see recorded failures.
4. Query `processed_requests` by `idempotency_key` to see the idempotency outcome.
5. Check Mailpit (`http://localhost:8025`) for the alert.
