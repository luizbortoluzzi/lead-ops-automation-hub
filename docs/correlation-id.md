# Correlation ID — `X-Correlation-Id`

A correlation id ties together every log line and stored activity for a single
logical request as it flows Client → n8n → backend → database. It makes a run
traceable end to end.

## Lifecycle

```text
caller/n8n sends X-Correlation-Id ─┐
                                   ▼
        CorrelationIdMiddleware (backend)
          - reuse a sane incoming value, OR generate a UUID
          - attach to the request (req.correlationId)
          - set response header X-Correlation-Id
                                   ▼
        LoggingInterceptor + ExceptionFilter
          - include [correlationId] in every log line
                                   ▼
        Activities endpoint
          - persist correlationId on lead_activities rows
                                   ▼
        Response header X-Correlation-Id ──▶ back to n8n
```

## How it is received or generated

[correlation-id.middleware.ts](../backend/src/common/correlation/correlation-id.middleware.ts):

1. Read `X-Correlation-Id` from the request.
2. **Sanitize** it — accept UUIDs or short opaque tokens matching
   `^[A-Za-z0-9._:-]+$` up to 128 chars; anything else (empty, oversized,
   weird characters) is rejected so callers can't inject junk into logs.
3. If nothing valid was provided, generate a `randomUUID()`.
4. Store it on the request and echo it on the response header.

## How it travels between n8n and the backend

- n8n generates/propagates the id in **WF01** (a Code node) and passes it as the
  `X-Correlation-Id` header on every backend call (upsert, activities), plus
  inside sub-workflow payloads (`correlationId` field).
- The backend always returns it in the response header, so n8n can log the same
  id it sent.

## How it appears in logs

Every request logs one line (headers/bodies are never logged):

```text
[f667f28d-e592-465f-aa7c-07d46218d245] POST /api/v1/leads/upsert 201 12.3ms
```

Errors (`>= 500`) log with the same prefix plus the error code and exception
name; 4xx log at `warn` level. See
[logging.interceptor.ts](../backend/src/common/interceptors/logging.interceptor.ts)
and [all-exceptions.filter.ts](../backend/src/common/filters/all-exceptions.filter.ts).

## How it is stored in activities

`POST /api/v1/leads/:id/activities` reads `X-Correlation-Id` from the header (via
the `@CorrelationId()` param decorator) and stores it on the
`lead_activities.correlation_id` column — so you can later query every action
taken during one automation run:

```sql
SELECT type, description, created_at
FROM lead_activities
WHERE correlation_id = 'f667f28d-e592-465f-aa7c-07d46218d245'
ORDER BY created_at;
```

## Why it helps diagnosis

When a lead intake misbehaves, grab the `X-Correlation-Id` from the n8n
execution (or the caller's response) and:

- `grep` it across backend logs to see the exact request timeline;
- query `lead_activities` to see what the automation recorded;

turning a vague "a lead didn't arrive" into a precise, single-run trace.
