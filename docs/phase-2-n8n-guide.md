# Phase 2 — Building the modular n8n Workflows by Hand

This guide walks you through building the Phase 2 automation in n8n: one
orchestrator (**WF01**) that calls four reusable **sub-workflows** (WF02–WF05).
You build everything by hand so you learn how orchestration, sub-workflows,
credentials, correlation ids and notifications fit together.

> Prerequisites
>
> - Stack up: `docker compose up --build -d` (or `make up`).
> - n8n at <http://localhost:5678>, Mailpit UI at <http://localhost:8025>.
> - The backend is reachable **from inside n8n** at `http://backend:3000` — never
>   `http://localhost:3000` (inside the container `localhost` is n8n itself).
> - The `workflows/*.json` files in this repo are **scaffolds/starting points**.
>   You can import them, but you must (re)wire credentials and the sub-workflow
>   references by hand — which is exactly what this guide covers.

## 0. Architecture recap

```text
WF01 Lead Intake (orchestrator, has the Webhook)
  → WF02 Normalize Lead        (in: raw lead → out: normalized + isValid/errors)
  → WF03 Backend Lead Upsert   (in: lead → POST /upsert → out: lead + operation)
  → WF04 Register Lead Activity(in: leadId+type → POST /activities)
  → WF05 Notify Sales          (in: enterprise lead → Mailpit SMTP)
```

Responsibility rule: **n8n normalizes and pre-validates; the backend is the
source of truth** (final validation, scoring, segment, persistence). Never
compute the final score/segment in n8n.

---

## 1. Credentials (create these first, once)

### 1.1 Backend API key — Header Auth

Credentials → **New** → **Header Auth**:

| Field  | Value                                             |
| ------ | ------------------------------------------------- |
| Name   | `LeadOps Backend API`                             |
| Name (header) | `X-API-Key`                                 |
| Value  | the same string as `BACKEND_API_KEY` in your `.env` |

You will select this credential in every HTTP Request node. The value lives in
n8n's encrypted store and is **not** exported in the workflow JSON.

### 1.2 Mailpit — SMTP

Credentials → **New** → **SMTP**:

| Field    | Value               |
| -------- | ------------------- |
| Name     | `Mailpit SMTP`      |
| Host     | `mailpit`           |
| Port     | `1025`              |
| SSL/TLS  | off                 |
| User / Password | leave empty  |

---

## 2. WF02 — Normalize Lead (build this sub-workflow first)

Create a new workflow named **`WF02 — Normalize Lead`**.

### 2.1 Trigger

Add an **Execute Workflow Trigger** node (named `When Executed by Another
Workflow`). This makes the workflow callable as a sub-workflow. Its output is the
input object passed by the caller.

Expected input:

```json
{
  "correlationId": "f667f28d-e592-465f-aa7c-07d46218d245",
  "lead": {
    "externalId": " landing-page-123 ",
    "name": " Maria Silva ",
    "email": " MARIA@EXAMPLE.COM ",
    "phone": "(11) 99999-8888",
    "company": " Acme Ltda ",
    "employees": "85",
    "source": "LANDING-PAGE"
  }
}
```

### 2.2 Code node — `Normalize And Validate`

Add a **Code** node (Mode: **Run Once for Each Item**):

```javascript
// WF02 Normalize And Validate — Run Once for Each Item
const input = $json;
const raw = input.lead ?? {};

const str = (v) => (v === undefined || v === null ? undefined : String(v).trim());
const digits = (v) => (v === undefined || v === null ? undefined : String(v).replace(/\D/g, ''));
const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

const lead = {
  externalId: str(raw.externalId) || undefined,
  name: str(raw.name),
  email: str(raw.email)?.toLowerCase(),
  phone: digits(raw.phone) || undefined,
  company: str(raw.company) || undefined,
  employees: num(raw.employees) ?? 0,
  source: str(raw.source)?.toLowerCase() || undefined,
};

// Cheap validation only — the backend does the definitive validation.
const errors = [];
if (!lead.name) errors.push({ path: 'name', message: 'name is required' });
if (!lead.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email))
  errors.push({ path: 'email', message: 'a valid email is required' });
if (lead.employees < 0) errors.push({ path: 'employees', message: 'employees must be >= 0' });

return {
  json: {
    isValid: errors.length === 0,
    errors,
    correlationId: input.correlationId,
    lead,
  },
};
```

Save. This is the whole sub-workflow — output matches the contract in the task.

---

## 3. WF03 — Backend Lead Upsert

Create **`WF03 — Backend Lead Upsert`**.

### 3.1 Execute Workflow Trigger

Input contract:

```json
{ "correlationId": "…", "lead": { "externalId": "…", "name": "…", "email": "…", "phone": "…", "company": "…", "employees": 85, "source": "landing-page" } }
```

### 3.2 HTTP Request node — `POST Upsert`

| Setting          | Value                                         |
| ---------------- | --------------------------------------------- |
| Method           | `POST`                                        |
| URL              | `http://backend:3000/api/v1/leads/upsert`     |
| Authentication   | Generic Credential Type → **Header Auth** → `LeadOps Backend API` |
| Send Headers     | On                                            |
| Header           | `X-Correlation-Id` = `={{ $json.correlationId }}` |
| Send Body        | On → JSON                                      |
| Specify Body     | Using JSON                                     |
| **Options → Response → Never Error** | **On** (so 4xx/409 don't throw; you map them) |
| Options → Response → Full Response | **On** (so you get `statusCode`) |

Body (expression mode `=`):

```javascript
={{ {
  externalId: $json.lead.externalId,
  name: $json.lead.name,
  email: $json.lead.email,
  phone: $json.lead.phone,
  company: $json.lead.company,
  employees: $json.lead.employees,
  source: $json.lead.source
} }}
```

> Do **not** send `score`/`segment` — the backend computes them (and ignores any
> you send).

### 3.3 Code node — `Map Upsert Result`

```javascript
// WF03 Map Upsert Result — Run Once for Each Item
const res = $json;               // Full Response: { statusCode, body, headers }
const status = res.statusCode;
const body = res.body ?? {};
const correlationId = $node['POST Upsert'].json.headers?.['x-correlation-id'];

const success = status === 200 || status === 201;
return {
  json: {
    success,
    statusCode: status,
    operation: status === 201 ? 'created' : status === 200 ? 'updated' : 'none',
    lead: success ? body.data : null,
    error: success ? null : body.error ?? { code: 'UNKNOWN' },
    correlationId,
  },
};
```

Output contract (on success):

```json
{ "success": true, "statusCode": 201, "operation": "created",
  "lead": { "id": "…", "name": "…", "email": "…", "score": 65, "segment": "medium" },
  "correlationId": "…" }
```

---

## 4. WF04 — Register Lead Activity

Create **`WF04 — Register Lead Activity`**.

### 4.1 Execute Workflow Trigger

Input:

```json
{ "correlationId": "…", "leadId": "…", "type": "AUTOMATION_PROCESSED",
  "description": "Lead processed by n8n", "metadata": { "workflow": "WF01 — Lead Intake" } }
```

### 4.2 HTTP Request node — `POST Activity`

| Setting        | Value                                                            |
| -------------- | --------------------------------------------------------------- |
| Method         | `POST`                                                          |
| URL            | `=http://backend:3000/api/v1/leads/{{ $json.leadId }}/activities` |
| Authentication | Header Auth → `LeadOps Backend API`                             |
| Send Headers   | On → `X-Correlation-Id` = `={{ $json.correlationId }}`          |
| Send Body      | On → JSON                                                        |
| Options → Response → Never Error | On                                            |

Body:

```javascript
={{ {
  type: $json.type,
  description: $json.description,
  metadata: $json.metadata ?? {}
} }}
```

> `leadId` goes in the URL, never the body. The backend takes the id from the URL.

---

## 5. WF05 — Notify Sales

Create **`WF05 — Notify Sales`**.

### 5.1 Execute Workflow Trigger

Input:

```json
{ "correlationId": "…", "lead": { "id": "…", "name": "…", "email": "…",
  "company": "…", "employees": 220, "score": 100, "segment": "enterprise" } }
```

### 5.2 Code node — `Build Email Data` (optional but clean)

```javascript
// WF05 Build Email Data — Run Once for Each Item
const { lead, correlationId } = $json;
const subject = `[LeadOps] Novo lead enterprise: ${lead.name}`;
const text = [
  `Nome: ${lead.name}`,
  `E-mail: ${lead.email}`,
  `Empresa: ${lead.company ?? '-'}`,
  `Funcionários: ${lead.employees}`,
  `Score: ${lead.score}`,
  `Segmento: ${lead.segment}`,
  `Correlation ID: ${correlationId ?? '-'}`,
].join('\n');
return { json: { subject, text, to: 'sales@example.local' } };
```

### 5.3 Send Email node — `Send Email (Mailpit)`

| Setting     | Value                                    |
| ----------- | ---------------------------------------- |
| Credential  | `Mailpit SMTP`                           |
| From        | `leadops@example.local` (or `SMTP_FROM`) |
| To          | `={{ $json.to }}`                        |
| Subject     | `={{ $json.subject }}`                   |
| Email Format| Text                                     |
| Text        | `={{ $json.text }}`                      |

After it runs, open <http://localhost:8025> to see the captured e-mail. No real
mail is sent.

### 5.4 Return

Add a **Set/Edit Fields** node returning `{ notified: true, correlationId }` so
the caller can register `ENTERPRISE_NOTIFICATION_SENT`.

---

## 6. WF01 — Lead Intake (orchestrator)

Create **`WF01 — Lead Intake`**. This is the only workflow with a Webhook.

### 6.1 Webhook — `Receive Lead`

| Setting     | Value                             |
| ----------- | --------------------------------- |
| HTTP Method | `POST`                            |
| Path        | `lead`                            |
| Respond     | `Using 'Respond to Webhook' node` |

### 6.2 Edit Fields — `Extract Request`

Pull body and the incoming correlation header into a clean shape (Manual mapping,
expressions):

- `body` = `={{ $json.body }}`
- `incomingCorrelationId` = `={{ $json.headers['x-correlation-id'] }}`

### 6.3 Code — `Ensure Correlation ID`

```javascript
// WF01 Ensure Correlation ID — Run Once for Each Item
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
const incoming = $json.incomingCorrelationId;
const correlationId =
  typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : uuid();
return { json: { correlationId, lead: $json.body } };
```

### 6.4 Execute Sub-workflow — `Normalize Lead`

Add an **Execute Workflow** node:

- Source: **Database** → select **`WF02 — Normalize Lead`**.
- Mode: **Run once with all items** (single item here).
- Workflow Inputs (expression): `={{ { correlationId: $json.correlationId, lead: $json.lead } }}`

Its output is the normalized `{ isValid, errors, correlationId, lead }`.

### 6.5 If — `Basic Input Valid?`

- Condition (Boolean): `={{ $json.isValid }}` **is true**.
- **false** → `Respond — Validation Error` (see 6.10).
- **true** → `Backend Lead Upsert`.

### 6.6 Execute Sub-workflow — `Backend Lead Upsert`

- Select **`WF03 — Backend Lead Upsert`**.
- Inputs: `={{ { correlationId: $json.correlationId, lead: $json.lead } }}`

If `success` is false, branch to a Respond node mapping the backend status (see
§8). For the happy path continue.

### 6.7 Execute Sub-workflow — `Register Processed Activity`

- Select **`WF04 — Register Lead Activity`**.
- Inputs:

```javascript
={{ {
  correlationId: $json.correlationId,
  leadId: $json.lead.id,
  type: 'AUTOMATION_PROCESSED',
  description: 'Lead processed by n8n',
  metadata: { workflow: 'WF01 — Lead Intake', source: $json.lead.source }
} }}
```

> Keep a reference to the upsert result. Use `$node['Backend Lead Upsert'].json`
> to read `lead`, `operation`, `correlationId` downstream.

### 6.8 Switch — `Lead Segment`

- Mode: **Rules**, Data: `={{ $node['Backend Lead Upsert'].json.lead.segment }}`
- Rules (String equals): `small`, `medium`, `enterprise`.
- `small` and `medium` → go straight to `Respond — Success`.
- `enterprise` → `Notify Sales`.

### 6.9 Enterprise branch

1. **Execute Sub-workflow — `Notify Sales`** (WF05), inputs:
   `={{ { correlationId: $node['Backend Lead Upsert'].json.correlationId, lead: $node['Backend Lead Upsert'].json.lead } }}`
2. **Execute Sub-workflow — `Register Notification Activity`** (WF04), inputs:

```javascript
={{ {
  correlationId: $node['Backend Lead Upsert'].json.correlationId,
  leadId: $node['Backend Lead Upsert'].json.lead.id,
  type: 'ENTERPRISE_NOTIFICATION_SENT',
  description: 'Enterprise lead notified via Mailpit',
  metadata: { workflow: 'WF05 — Notify Sales' }
} }}
```

3. → `Respond — Success`.

### 6.10 Respond to Webhook nodes

`Respond — Success`:

- Response Code: `={{ $node['Backend Lead Upsert'].json.statusCode }}` (201/200)
- Body: `={{ { data: $node['Backend Lead Upsert'].json.lead, meta: { operation: $node['Backend Lead Upsert'].json.operation }, correlationId: $node['Backend Lead Upsert'].json.correlationId } }}`

`Respond — Validation Error`:

- Response Code: `400`
- Body: `={{ { error: { code: 'VALIDATION_ERROR', message: 'Invalid lead payload', details: $json.errors } } }}`

---

## 7. Testing with the Test URL

1. On WF01's Webhook click **Listen for test event**.
2. Send a lead (host → n8n uses `localhost`):

```bash
curl -i -X POST http://localhost:5678/webhook-test/lead \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: f667f28d-e592-465f-aa7c-07d46218d245" \
  -d @samples/valid-lead.json
```

Expected: `201` (first time) or `200` (subsequent), body with `data` + `meta`.

3. Enterprise path — send `samples/enterprise-lead.json`, then check
   <http://localhost:8025> for the captured e-mail.

4. Invalid input:

```bash
curl -i -X POST http://localhost:5678/webhook-test/lead \
  -H "Content-Type: application/json" -d @samples/invalid-lead.json
# → 400 with error.details
```

### Inspecting nodes

Click any node after a run: **INPUT** (left) / **OUTPUT** (right). On
`Backend Lead Upsert` check `statusCode` and `operation`. On the Execute Workflow
nodes, confirm the sub-workflow's output object.

### Test URL vs Production URL

| | Test URL (`/webhook-test/lead`) | Production URL (`/webhook/lead`) |
| --- | --- | --- |
| Works when | "Listen for test event" is active | workflow is **Active** |
| Per-node data | yes | no |
| Use for | building/debugging | real traffic |

---

## 8. Diagnosing status codes

| Status | Meaning | What to check |
| ------ | ------- | ------------- |
| `400`  | Invalid payload | WF02 errors, or backend `error.details` in the upsert response |
| `401`  | API key missing/invalid | Header Auth credential value vs `BACKEND_API_KEY`; you should not be hardcoding it |
| `404`  | Lead not found (activities) | the `leadId` you sent; only register after a successful upsert |
| `409`  | Identity conflict / duplicate | externalId and e-mail point to different leads — inspect both |
| `500`  | Backend failure | `docker compose logs backend`; grep the `X-Correlation-Id` |

Do **not** add retries in Phase 2. Never auto-retry `400/401/404/409`.

Reset the DB while testing:

```bash
docker compose exec postgres psql -U leadops -d leadops -c "TRUNCATE lead_activities, leads CASCADE;"
```

---

## 9. Activating and exporting

- **Activate**: toggle WF01 to **Active** (sub-workflows don't need to be active
  to be called, but keeping them saved is enough). Then use the Production URL.
- **Export**: for each workflow, **⋯ menu → Download**, and save into
  `workflows/WFxx-….json`. Before committing, confirm no credential secrets are
  embedded (n8n exports credential **references**, not values — verify anyway).

---

## 10. Final checklist

- [ ] Credentials `LeadOps Backend API` (Header Auth) and `Mailpit SMTP` created.
- [ ] WF02–WF05 each have an **Execute Workflow Trigger** and match their I/O contract.
- [ ] WF01 Webhook set to *Respond: Using 'Respond to Webhook' node*.
- [ ] Correlation id is generated when absent and forwarded as `X-Correlation-Id`.
- [ ] Upsert node posts to `http://backend:3000/api/v1/leads/upsert` with Header Auth.
- [ ] Score/segment come from the backend response and drive the Switch.
- [ ] `AUTOMATION_PROCESSED` recorded after upsert; `ENTERPRISE_NOTIFICATION_SENT`
      recorded after an enterprise notification.
- [ ] Only `enterprise` triggers the Mailpit e-mail; small/medium do not.
- [ ] Valid → 201/200, invalid → 400, and the response carries `X-Correlation-Id`.
- [ ] No API key or secret is hardcoded in any node or exported JSON.
- [ ] Workflows exported into `workflows/`.
