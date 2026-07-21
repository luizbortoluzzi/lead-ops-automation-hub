# API Authentication — `X-API-Key`

Phase 2 introduces machine-to-machine authentication between n8n and the
backend. Every `/api/v1/**` route requires a valid API key; `/health` stays
public.

## The header

```http
X-API-Key: <BACKEND_API_KEY>
```

- Missing or wrong key → `401 Unauthorized`:

  ```json
  { "error": { "code": "UNAUTHORIZED", "message": "Missing or invalid API key", "details": [] } }
  ```

## Backend configuration

- The expected key comes from the env var `BACKEND_API_KEY` (validated at
  startup — the process refuses to boot without it).
- Enforcement is centralized in a **global guard**
  ([api-key.guard.ts](../backend/src/common/auth/api-key.guard.ts)) registered via
  `APP_GUARD`. Routes opt out with the `@Public()` decorator
  ([public.decorator.ts](../backend/src/common/auth/public.decorator.ts)) — only
  `HealthController` uses it.
- The comparison is **constant-time** (`crypto.timingSafeEqual`) to avoid timing
  side channels.
- The key is **never logged**. The logging interceptor logs method/path/status
  only; the exception filter logs error codes, never headers.

## n8n configuration (Credentials, not hardcoded)

Create a **Header Auth** credential in n8n and reference it from the HTTP Request
nodes — never paste the key into a node or into an exported workflow.

| Field  | Value                       |
| ------ | --------------------------- |
| Name   | `LeadOps Backend API`       |
| Header | `X-API-Key`                 |
| Value  | same as `BACKEND_API_KEY`   |

In each HTTP Request node: **Authentication → Generic Credential Type → Header
Auth → LeadOps Backend API**. The value stays in n8n's encrypted credential
store and is not part of `workflows/*.json`.

## Security notes

- **Do not** hardcode the key in workflows, code, or Git. `.env` is git-ignored;
  only `.env.example` (with a placeholder) is committed.
- Rotate by changing `BACKEND_API_KEY` and the n8n credential together.
- This is a shared-secret scheme suitable for a trusted internal caller (n8n).
  It is not user authentication and does not replace network isolation.
- For production you would additionally scope keys per client, add rate
  limiting, and terminate TLS in front of the backend — out of scope for Phase 2.

## cURL

```bash
# authorized
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" \
  -H "X-API-Key: change-me-development-key" \
  -d @samples/valid-lead.json

# unauthorized → 401
curl -i -X POST http://localhost:3000/api/v1/leads/upsert \
  -H "Content-Type: application/json" -d '{}'
```
