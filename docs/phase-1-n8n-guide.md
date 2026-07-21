# Phase 1 — Building the n8n Workflow by Hand

This guide walks you through building the lead-intake workflow **manually** in
n8n so you learn each concept. Nothing here is auto-generated for you — you will
add every node yourself.

> Prerequisite: the stack is up (`docker compose up --build -d`) and n8n is
> reachable at <http://localhost:5678>. The Backend is reachable **from inside
> the n8n container** at `http://backend:3000` (Docker service name), **not**
> `localhost:3000`.

## Target workflow

```text
Webhook
  ↓
Normalize Lead   (Code)
  ↓
Validate Lead    (Code)
  ↓
Is Valid?        (If)
  ├── false → Respond 400 (Respond to Webhook)
  └── true
        ↓
      Score Lead   (Code)
        ↓
      Route Segment (Switch)   ← illustrative branching by segment
        ↓ (all branches continue)
      Create Lead in Backend (HTTP Request)
        ↓
      Respond 201 (Respond to Webhook)
```

Name your workflow **`Lead Intake — Phase 1`**.

---

## 0. Concepts you'll use

- **Items**: data flows as an array of items; each item has a `json` object. One
  webhook call = one item here.
- **Expressions**: `{{ ... }}` evaluates JavaScript. `$json` is the current
  item's JSON; `$node["Node Name"].json` reads another node's output.
- **Code node**: runs JS over items. Use **Run Once for Each Item** for
  per-lead logic so `$json` is a single lead.
- **Respond to Webhook**: the Webhook must be set to *Respond: Using 'Respond to
  Webhook' node* so you control the status code and body.

---

## 1. Webhook node — `Webhook`

Add a **Webhook** node.

| Setting            | Value                                   |
| ------------------ | --------------------------------------- |
| HTTP Method        | `POST`                                  |
| Path               | `lead`                                  |
| Respond            | `Using 'Respond to Webhook' node`       |
| Authentication     | `None` (local dev only)                 |

- **Test URL** looks like `http://localhost:5678/webhook-test/lead`. It only
  fires while the editor is in **“Listen for test event”** and lets you inspect
  every node's data. Use it while building.
- **Production URL** looks like `http://localhost:5678/webhook/lead`. It only
  works after the workflow is **Active** and does **not** show per-node data in
  the editor. Use it once the workflow is done.

The incoming body arrives under `{{ $json.body }}` (n8n wraps the HTTP body in a
`body` property). Keep that in mind for the next node.

---

## 2. Code node — `Normalize Lead`

Add a **Code** node named `Normalize Lead`. Set **Mode → Run Once for Each
Item**. This trims strings, lowercases the e-mail, and coerces numbers so
downstream logic is predictable.

```javascript
// Normalize Lead — Run Once for Each Item
// Input: the raw webhook item. The HTTP body is under $json.body.
const body = $json.body ?? $json;

const str = (v) =>
  v === undefined || v === null ? undefined : String(v).trim();

const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

const normalized = {
  externalId: str(body.externalId),
  name: str(body.name),
  email: str(body.email)?.toLowerCase(),
  phone: str(body.phone),
  company: str(body.company),
  employees: num(body.employees) ?? 0,
  source: str(body.source)?.toLowerCase(),
};

return { json: normalized };
```

Output is a clean lead object (no `score`/`segment` yet).

---

## 3. Code node — `Validate Lead`

Add a **Code** node named `Validate Lead`, **Run Once for Each Item**. It sets a
boolean `valid` and a list of `errors` — it does **not** throw, so the `If` node
can branch on the result.

```javascript
// Validate Lead — Run Once for Each Item
const lead = $json;
const errors = [];

if (!lead.name) {
  errors.push({ path: 'name', message: 'name is required' });
}

const email = lead.email;
const emailOk = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
if (!emailOk) {
  errors.push({ path: 'email', message: 'a valid email is required' });
}

if (lead.employees !== undefined && (!Number.isInteger(lead.employees) || lead.employees < 0)) {
  errors.push({ path: 'employees', message: 'employees must be a non-negative integer' });
}

return {
  json: {
    ...lead,
    valid: errors.length === 0,
    errors,
  },
};
```

---

## 4. If node — `Is Valid?`

Add an **If** node named `Is Valid?`.

- Condition type: **Boolean**.
- Value 1 (expression): `{{ $json.valid }}`
- Operator: **is true**

Wire outputs:

- **true** → `Score Lead` (step 5)
- **false** → `Respond 400` (step 8)

---

## 5. Code node — `Score Lead`

Add a **Code** node named `Score Lead`, **Run Once for Each Item**. This is the
deterministic scoring engine. Every rule is explicit and commented.

```javascript
// Score Lead — Run Once for Each Item
// Deterministic lead scoring. Score = employees + source + completeness.
const lead = $json;

// --- Firmographics: company size --------------------------------------------
function employeeScore(employees) {
  const n = Number.isFinite(employees) ? employees : 0;
  if (n >= 201) return 70; // 201+
  if (n >= 51) return 50; //  51–200
  if (n >= 11) return 25; //  11–50
  if (n >= 1) return 10; //   1–10
  return 0; //                0
}

// --- Acquisition source ------------------------------------------------------
function sourceScore(source) {
  switch (source) {
    case 'referral':
    case 'indication':
      return 20;
    case 'landing-page':
      return 10;
    case 'csv-import':
      return 5;
    default:
      return 0;
  }
}

// --- Data completeness -------------------------------------------------------
function completenessScore(lead) {
  let bonus = 0;
  if (lead.phone) bonus += 5; // phone present
  if (lead.company) bonus += 5; // company present
  return bonus;
}

// --- Segmentation from the final score --------------------------------------
function segmentFor(score) {
  if (score >= 70) return 'enterprise'; // 70+
  if (score >= 30) return 'medium'; //     30–69
  return 'small'; //                       0–29
}

const score = employeeScore(lead.employees) + sourceScore(lead.source) + completenessScore(lead);
const segment = segmentFor(score);

return {
  json: {
    ...lead,
    score,
    segment,
  },
};
```

> Sanity check with the sample lead (`employees: 85`, `source: landing-page`,
> phone + company present): `50 + 10 + 5 + 5 = 70` → `enterprise`.

---

## 6. Switch node — `Route Segment`

Add a **Switch** node named `Route Segment`. In Phase 1 all branches go to the
same next node, so the Switch is here to **teach routing** and to give you a hook
for segment-specific logic later (e.g. notify sales only for `enterprise`).

- Mode: **Rules**
- Data (expression): `{{ $json.segment }}`
- Rules (String, equals):
  1. `small`
  2. `medium`
  3. `enterprise`

Wire **all three** outputs into `Create Lead in Backend` (step 7). (You can also set
a Fallback output → `Create Lead in Backend` to be safe.)

---

## 7. HTTP Request node — `Create Lead in Backend`

Add an **HTTP Request** node named `Create Lead in Backend`.

| Setting                        | Value                                                  |
| ------------------------------ | ------------------------------------------------------ |
| Method                         | `POST`                                                 |
| URL                            | `http://backend:3000/api/leads`                       |
| Authentication                 | `None`                                                 |
| Send Body                      | `On`                                                   |
| Body Content Type              | `JSON`                                                 |
| Specify Body                   | `Using JSON`                                            |
| JSON                           | *(expression below)*                                   |
| Options → Response → Full Response | `Off` (return body only)                           |
| Options → Ignore SSL Issues    | not needed (plain HTTP)                                 |

> Use the **service name** `backend`, not `localhost` — inside the n8n container
> `localhost` is the n8n container itself.

**JSON body** (toggle the field to expression mode, `=`):

```javascript
={{ {
  externalId: $json.externalId,
  name: $json.name,
  email: $json.email,
  phone: $json.phone,
  company: $json.company,
  employees: $json.employees,
  source: $json.source,
  score: $json.score,
  segment: $json.segment
} }}
```

### Handling Backend errors (409 / 400)

By default the HTTP Request node throws on non-2xx, which would surface as a 500
to your webhook caller. To translate Backend errors into meaningful responses:

- Open **Settings** on the node and enable **On Error → Continue (using error
  output)**, *or* set **Options → Response → Never Error** and inspect the status
  code yourself.
- For a first version, leaving the default (throw on error) is fine — a duplicate
  e-mail will simply fail the execution, which you'll see in the editor.

The Backend returns the created lead as JSON with HTTP `201`.

---

## 8. Respond to Webhook — success and failure

### `Respond 201` (success path, after `Create Lead in Backend`)

Add a **Respond to Webhook** node named `Respond 201`.

| Setting          | Value                          |
| ---------------- | ------------------------------ |
| Respond With     | `JSON`                         |
| Response Code    | `201`                          |
| Response Body    | *(expression below)*           |

```javascript
={{ {
  status: 'created',
  lead: $json
} }}
```

### `Respond 400` (failure path, from `Is Valid?` → false)

Add a **Respond to Webhook** node named `Respond 400`.

| Setting          | Value                          |
| ---------------- | ------------------------------ |
| Respond With     | `JSON`                         |
| Response Code    | `400`                          |
| Response Body    | *(expression below)*           |

```javascript
={{ {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid lead payload',
    details: $json.errors
  }
} }}
```

---

## 9. Testing with the Test URL

1. Click **Listen for test event** (or **Execute Workflow**) on the Webhook node.
2. Copy the **Test URL** (`.../webhook-test/lead`).
3. Send a valid lead from your host machine (host → n8n uses `localhost`):

```bash
curl -i -X POST http://localhost:5678/webhook-test/lead \
  -H "Content-Type: application/json" \
  -d @samples/valid-lead.json
```

Expected: HTTP `201` with the created lead.

4. Send an invalid lead:

```bash
curl -i -X POST http://localhost:5678/webhook-test/lead \
  -H "Content-Type: application/json" \
  -d @samples/invalid-lead.json
```

Expected: HTTP `400` with `error.code = VALIDATION_ERROR` and a populated
`details` array.

### Inspecting input/output of each node

After an execution, click any node to open its panel:

- **INPUT** (left) shows what the node received; **OUTPUT** (right) shows what it
  produced.
- Toggle **Table / JSON / Schema** views.
- On the `Score Lead` node, confirm `score` and `segment` match the rules.
- On `Create Lead in Backend`, the OUTPUT is the Backend's JSON response (the created
  lead with its `id`).

---

## 10. Test URL vs Production URL

| Aspect            | Test URL (`/webhook-test/lead`)          | Production URL (`/webhook/lead`)      |
| ----------------- | ---------------------------------------- | ------------------------------------- |
| When it works     | Only while “Listen for test event” is on | Only when the workflow is **Active**  |
| Per-node data     | Yes — full inspection in the editor      | No — runs headless                    |
| Use for           | Building & debugging                      | Real/integration usage                |
| Fires how often   | One captured event, then stops           | Every request                         |

---

## 11. Diagnosing status codes

| You see | Likely cause                                                                 | Where to look                                                                 |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `400`   | Validation failed (your `Validate Lead`, or the Backend's Zod)                   | `Is Valid?` false branch; Backend response body `error.details`                   |
| `404`   | Lead lookup missed (only relevant if you add GET calls)                      | Backend `LEAD_NOT_FOUND`; check the e-mail/UUID you queried                        |
| `409`   | Duplicate e-mail — the lead already exists in Postgres                        | Backend `LEAD_ALREADY_EXISTS`; change the e-mail or clear the table               |
| `500`   | Unhandled error: wrong Backend URL, Backend down, or HTTP node threw on a 4xx        | Execution log; `docker compose logs backend`; verify URL is `http://backend:3000` |

Quick checks:

- Backend reachable from n8n? The `Create Lead in Backend` node erroring with a
  connection error usually means a wrong host (`localhost` instead of
  `backend`) or the Backend container isn't healthy (`docker compose ps`).
- Duplicate e-mail during testing? Reset the table:
  `docker compose exec postgres psql -U leadops -d leadops -c "TRUNCATE leads;"`

---

## 12. Activating the workflow

1. Ensure both `Respond 201` and `Respond 400` are wired (every path must reach a
   Respond node, or the caller hangs).
2. Toggle **Active** (top-right).
3. Use the **Production URL** now:

```bash
curl -i -X POST http://localhost:5678/webhook/lead \
  -H "Content-Type: application/json" \
  -d @samples/valid-lead.json
```

---

## 13. Final validation checklist

- [ ] Webhook: `POST`, path `lead`, **Respond: Using 'Respond to Webhook' node**.
- [ ] `Normalize Lead` reads from `$json.body`, lowercases e-mail, coerces
      `employees` to an integer.
- [ ] `Validate Lead` sets `valid` + `errors` and never throws.
- [ ] `Is Valid?` true → `Score Lead`; false → `Respond 400`.
- [ ] `Score Lead` reproduces the sample: `85 employees + landing-page + phone +
      company = 70 → enterprise`.
- [ ] `Route Segment` has rules for `small`/`medium`/`enterprise` (+ fallback),
      all reaching `Create Lead in Backend`.
- [ ] `Create Lead in Backend` posts to `http://backend:3000/api/leads` with the
      full JSON body.
- [ ] `Respond 201` returns the created lead; `Respond 400` returns the
      validation error envelope.
- [ ] Valid payload → `201`; invalid payload → `400`; duplicate e-mail →
      surfaces `409` from the Backend.
- [ ] No credentials are hardcoded anywhere in the workflow.
- [ ] Workflow toggled **Active**; Production URL returns `201` for a fresh lead.
```
