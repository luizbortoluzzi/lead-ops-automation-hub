# Phase 3 — n8n Guide (Idempotency, Retry, Error Handling)

Build the resilient version of the automation by hand. This adds: an idempotency
key, a reusable retry sub-workflow (WF06), a global error handler (WF99), and a
notification-reprocessing flow (WF07).

> Prerequisites: stack up (`make up`), backend at `http://backend:3000` from
> inside n8n, Mailpit at `http://localhost:8025`. `workflows/*.json` are
> importable scaffolds — after importing, wire credentials and sub-workflow
> references by hand.

## 1. Objective

Make the pipeline **idempotent, resilient, observable and reprocessable**:
duplicate requests don't duplicate effects; only temporary failures are retried
(with backoff); definitive failures are persisted and alerted; a failed
notification can be reprocessed without re-running the upsert.

## 2. Idempotency in one minute

- **Correlation ID** (`X-Correlation-Id`): traces one logical run across services
  (for logs/diagnosis). May be generated when absent.
- **Idempotency Key** (`Idempotency-Key`): deduplicates a **write**. Same key +
  same payload → the backend replays the original response; same key + different
  payload → `409`. **Never generate a random key when absent** — respond `400`.

## 3. Responsibilities

- **Backend** owns idempotency (ledger, hash, atomic claim, replay/conflict),
  transactions, and definitive validation.
- **n8n** captures/forwards `Idempotency-Key`, preserves `X-Correlation-Id`,
  applies the retry policy, classifies failures, and records definitive failures.
  n8n never decides on its own that the primary operation completed.

## 4. Credentials

Reuse the Phase 2 credentials: `LeadOps Backend API` (Header Auth, `X-API-Key`)
and `Mailpit SMTP` (host `mailpit`, port `1025`, no TLS). Never hardcode secrets.

## 5. WF06 — Backend Request With Retry

Create **`WF06 — Backend Request With Retry`** (Execute Workflow Trigger). This is
specific to LeadOps backend calls — not a universal HTTP client.

Input:

```json
{
  "request": { "operation": "LEAD_UPSERT", "method": "POST", "path": "/api/v1/leads/upsert", "body": { "name": "Maria", "email": "maria@example.com", "employees": 85, "source": "landing-page" } },
  "correlationId": "f667f28d-…",
  "idempotencyKey": "landing-page-123",
  "attempt": 1
}
```

### 5.1 HTTP Request node — `Call Backend`

| Setting | Value |
| ------- | ----- |
| Method | `={{ $json.request.method }}` |
| URL | `=http://backend:3000{{ $json.request.path }}` |
| Authentication | Header Auth → `LeadOps Backend API` |
| Send Headers | On: `X-Correlation-Id` = `={{ $json.correlationId }}`, `Idempotency-Key` = `={{ $json.idempotencyKey }}` |
| Send Body | On → JSON → `={{ $json.request.body }}` |
| Options → Timeout | `5000` (N8N_BACKEND_REQUEST_TIMEOUT_MS) |
| Options → Response → Full Response | On |
| Options → Response → Never Error | On |

### 5.2 Code node — `Classify Result`

```javascript
// WF06 Classify Result — Run Once for Each Item
const res = $json;                       // { statusCode, body, headers }
const status = res.statusCode ?? 0;
const errorCode = res.body?.error?.code ?? null;
const retryAfterHeader = Number(res.headers?.['retry-after']);
const attempt = $node['Call Backend'] ? ($json.attempt ?? 1) : 1;

function classify(status, errorCode) {
  const retry = new Set([408, 425, 429, 500, 502, 503, 504]);
  if (status === 200 || status === 201) return { ok: true, retryable: false };
  if (status === 409 && errorCode === 'IDEMPOTENCY_IN_PROGRESS') return { ok: false, retryable: true };
  if (status === 409) return { ok: false, retryable: false };      // IDEMPOTENCY_CONFLICT
  if (retry.has(status)) return { ok: false, retryable: true };
  if (status === 0) return { ok: false, retryable: true };          // network timeout
  return { ok: false, retryable: false };                           // 400/401/403/404/unknown → conservative
}

const c = classify(status, errorCode);
return { json: { ...$json, statusCode: status, errorCode, ok: c.ok, retryable: c.retryable, retryAfter: Number.isFinite(retryAfterHeader) ? retryAfterHeader : null } };
```

### 5.3 If — `Success?`  → return result

On success, return `{ success:true, statusCode, operation, lead: body.data, correlationId }`.

### 5.4 If — `Retryable AND attempt < 4?`

- Condition: `={{ $json.retryable && $json.attempt < 4 }}`.
- **true** → `Wait` then loop back to `Call Backend` with `attempt + 1`.
- **false** → return `{ success:false, statusCode, errorCode, correlationId, attempt }` (WF01/WF99 handle it).

### 5.5 Wait node — `Backoff`

Amount (expression): pick the backoff by attempt, preferring `Retry-After`:

```javascript
={{ $json.retryAfter
     ? Math.min($json.retryAfter, 30)
     : ({1: 2, 2: 5, 3: 15}[$json.attempt] ?? 15) }}
```

Unit: seconds. To increment the attempt, add a small Set/Code node before looping:
`attempt = {{ $json.attempt + 1 }}`. **Cap at 4 total attempts — no infinite loop.**

## 6. WF03 update — delegate retry to WF06

`WF03 — Backend Lead Upsert` should now call **WF06** instead of doing its own
HTTP request:

```text
WF03 (knows the lead contract)
  → Execute WF06 with { request:{operation:'LEAD_UPSERT', method:'POST', path:'/api/v1/leads/upsert', body: <lead>}, correlationId, idempotencyKey, attempt:1 }
  → map WF06 output → { success, operation, lead, statusCode, correlationId }
```

Do not duplicate retry logic in WF03.

## 7. WF01 update — idempotency + partial failure

Add after `Ensure Correlation ID`:

### 7.1 Code — `Validate Idempotency Key`

```javascript
// WF01 Validate Idempotency Key — Run Once for Each Item
const key = $json.idempotencyKey ?? $json.headers?.['idempotency-key'];
if (typeof key !== 'string' || key.trim() === '' || key.length > 255) {
  return { json: { ...$json, idempotencyValid: false } };
}
return { json: { ...$json, idempotencyKey: key.trim(), idempotencyValid: true } };
```

- If invalid → `Respond — Validation Error` (`400`, code `IDEMPOTENCY_KEY_REQUIRED`).
- **Never** generate a random key.

### 7.2 After a successful upsert → notify (partial failure aware)

```text
Switch — segment
  └─ enterprise → Execute WF05 — Notify Sales
        → If Notification Successful?
            ├─ yes → Register ENTERPRISE_NOTIFICATION_SENT → Respond
            └─ no  → POST /api/v1/automation-failures (operation SEND_ENTERPRISE_NOTIFICATION)
                     → Respond (still 200/201) with meta.notification.status = 'failed'
```

The response `meta` reports the secondary failure but the main operation stays
successful:

```json
{ "data": { "id": "…", "segment": "enterprise" },
  "meta": { "operation": "created", "idempotencyReplayed": false,
            "notification": { "status": "failed", "failureId": "…" } } }
```

## 8. WF99 — Global Error Handler

Create **`WF99 — Global Error Handler`** with an **Error Trigger**.

### 8.1 Code — `Extract Error Context`

```javascript
// WF99 Extract Error Context — Run Once for Each Item
const e = $json;
const exec = e.execution ?? {};
const wf = e.workflow ?? {};
const err = e.execution?.error ?? e.error ?? {};
return { json: {
  correlationId: err.correlationId ?? e.correlationId ?? null,
  workflowName: wf.name ?? null,
  executionId: exec.id ?? null,
  nodeName: err.node?.name ?? null,
  operation: e.operation ?? 'OTHER',
  statusCode: err.httpCode ?? err.statusCode ?? null,
  errorCode: err.code ?? null,
  message: (err.message ?? 'Unknown error').toString().slice(0, 500),
  attempt: e.attempt ?? null,
} };
```

### 8.2 Code — `Classify` (same table as WF06), then `Sanitize Payload`

```javascript
// WF99 Sanitize Payload — Run Once for Each Item
const SENSITIVE = ['authorization','x-api-key','apikey','api_key','password','secret','token','cookie','set-cookie'];
function sanitize(v, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(v)) return v.slice(0, 100).map(x => sanitize(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = SENSITIVE.includes(k.toLowerCase()) ? '[REDACTED]' : sanitize(v[k], depth + 1);
    return o;
  }
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}
return { json: { ...$json, payload: sanitize($json.payload ?? {}) } };
```

### 8.3 HTTP Request — `Persist Failure`

`POST http://backend:3000/api/v1/automation-failures` (Header Auth), body from
the context above (`errorType`, `retryable`, `attempt`, `message`, `payload`, …).

### 8.4 If — `Should Alert?` → Send Email (Mailpit)

Alert **only** on a definitive failure (attempts exhausted, auth/config error,
persistent internal error, or a secondary op needing intervention) to
`operations@example.local`. Do **not** email per intermediate attempt.

### 8.5 Associate WF99 as the Error Workflow

For each workflow: **Settings → Error Workflow → WF99 — Global Error Handler**.

## 9. WF07 — Reprocess Failed Notification

Create **`WF07 — Reprocess Failed Notification`** (Manual Trigger or admin
webhook). Input `{ "failureId": "…" }`. See [reprocessing.md](reprocessing.md):

```text
GET /api/v1/automation-failures/:id
  → Reprocessable? (operation SEND_ENTERPRISE_NOTIFICATION, status OPEN, lead exists)
      no → Respond 409
      yes → PATCH /:id/reprocessing → GET /api/v1/leads/:leadId → WF05 Notify Sales
            → success → POST /:leadId/activities (ENTERPRISE_NOTIFICATION_SENT) → PATCH /:id/resolve
            → failure → keep OPEN
```

**No upsert is executed** during reprocessing.

## 10. Failure simulation

Enabled only in dev/test (`ENABLE_FAILURE_SIMULATION=true`, `NODE_ENV≠production`).
Send `X-Simulate-Error` on the upsert to force a failure and watch WF06 retry:

| Header value          | Backend response          |
| --------------------- | ------------------------- |
| `rate-limit`          | `429` + `Retry-After: 2`  |
| `server-error`        | `500`                     |
| `service-unavailable` | `503`                     |
| `timeout`             | delayed `504` (> n8n timeout) |
| `bad-request`         | `400`                     |

```bash
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" -H "X-API-Key: change-me-development-key" \
  -H "Idempotency-Key: rl-001" -H "X-Simulate-Error: rate-limit" \
  -d @samples/idempotent-request.json
```

## 11. Inspecting attempts

Open the WF06 execution: the loop shows each `Call Backend` run and each `Wait`.
Confirm the `attempt` counter increments and stops at 4. Confirm the same
`X-Correlation-Id` and `Idempotency-Key` on every attempt (open each HTTP node).

## 12. Testing checklist

Follow [phase-3-test-cases.md](phase-3-test-cases.md). In short:

- [ ] `400/401/conflict` do **not** retry.
- [ ] `429/500/503/timeout` **do** retry; stop after 4 attempts.
- [ ] Correlation ID and Idempotency Key identical across attempts.
- [ ] Replay returns the original response with `Idempotency-Replayed: true`.
- [ ] Same key + different payload → `409`.
- [ ] Concurrent identical requests → one lead.
- [ ] Definitive failure persisted in `automation_failures`; alert only at the end.
- [ ] Notification failure does not undo the lead; `meta.notification.status=failed`.
- [ ] Reprocessing sends the e-mail and does **not** create/update the lead.
- [ ] Export all workflows into `workflows/`; verify no secrets in the JSON.
