// Emulates the WF06 (retry+backoff), WF01 (idempotency) and WF07 (reprocess)
// LOGIC against the real backend, to validate the behaviors the n8n workflows
// depend on. This is NOT running n8n — it mirrors the workflow code paths.
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:3010';
const KEY = process.env.KEY ?? 'change-me-development-key';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
const SMTP_HOST = process.env.SMTP_HOST ?? 'localhost';
const SMTP_PORT = process.env.SMTP_PORT ?? '1025';

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsert({ idempotencyKey, correlationId, body, simulate }) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': KEY,
    'Idempotency-Key': idempotencyKey,
  };
  if (correlationId) headers['X-Correlation-Id'] = correlationId;
  if (simulate) headers['X-Simulate-Error'] = simulate;
  const res = await fetch(`${BASE}/api/v1/leads/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, headers: res.headers, json };
}

// WF06 classification (identical to workflows/WF06 Classify Result)
function classify(status, errorCode) {
  const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);
  if (status === 200 || status === 201) return { ok: true, retryable: false };
  if (status === 409 && errorCode === 'IDEMPOTENCY_IN_PROGRESS') return { ok: false, retryable: true };
  if (status === 409) return { ok: false, retryable: false };
  if (RETRY.has(status) || status === 0) return { ok: false, retryable: true };
  return { ok: false, retryable: false };
}

// WF06 retry loop
async function wf06({ idempotencyKey, correlationId, body, simulate }) {
  const sentCorrelation = new Set();
  let attempt = 1;
  while (true) {
    sentCorrelation.add(correlationId);
    const res = await upsert({ idempotencyKey, correlationId, body, simulate });
    const errorCode = res.json?.error?.code ?? null;
    const c = classify(res.status, errorCode);
    if (c.ok) return { success: true, status: res.status, attempts: attempt, sentCorrelation };
    if (c.retryable && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = retryAfter ? Math.min(retryAfter, 2) : { 1: 2, 2: 2, 3: 2 }[attempt] ?? 2; // capped for the harness
      await sleep(backoff * 1000);
      attempt += 1;
      continue;
    }
    return { success: false, status: res.status, errorCode, attempts: attempt, sentCorrelation };
  }
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function sendMail(subject, textBody, to = 'sales@example.local') {
  execFileSync('python3', [
    '-c',
    `import smtplib,sys
from email.message import EmailMessage
m=EmailMessage(); m['From']='leadops@example.local'; m['To']=sys.argv[3]; m['Subject']=sys.argv[1]; m.set_content(sys.argv[2])
s=smtplib.SMTP('${SMTP_HOST}', ${SMTP_PORT}); s.send_message(m); s.quit()`,
    subject,
    textBody,
    to,
  ]);
}

async function mailpitMessages() {
  const res = await fetch(`${MAILPIT}/api/v1/messages`);
  return res.json();
}

const validBody = {
  externalId: 'harness-1',
  name: 'Maria Silva',
  email: 'harness@example.com',
  employees: 40,
  source: 'landing-page',
};
const enterpriseBody = {
  externalId: 'harness-ent',
  name: 'Joao Enterprise',
  email: 'harness-ent@example.com',
  employees: 220,
  source: 'referral',
};

async function main() {
  // reset relevant rows
  execFileSync('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'leadops',
    '-d',
    'leadops',
    '-c',
    'TRUNCATE processed_requests, automation_failures, lead_activities, leads CASCADE;',
  ]);
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

  console.log('== 1) First request (WF06 happy path) ==');
  const r1 = await wf06({ idempotencyKey: 'h-1', correlationId: 'cid-1', body: validBody });
  check('first request succeeds in 1 attempt (201)', r1.success && r1.attempts === 1, `status=${r1.status}`);

  console.log('== 2) Replay (same key + payload) ==');
  const r2 = await upsert({ idempotencyKey: 'h-1', correlationId: 'cid-2', body: validBody });
  check('replay preserves status', r2.status === 201, `status=${r2.status}`);
  check('Idempotency-Replayed: true', r2.headers.get('idempotency-replayed') === 'true');
  check('X-Original-Correlation-Id = first cid', r2.headers.get('x-original-correlation-id') === 'cid-1');

  console.log('== 3) Conflict (same key + different payload) — must NOT retry ==');
  const r3 = await wf06({ idempotencyKey: 'h-1', correlationId: 'cid-3', body: { ...validBody, email: 'other@example.com', externalId: 'x' } });
  check('conflict → 409 IDEMPOTENCY_CONFLICT', r3.status === 409 && r3.errorCode === 'IDEMPOTENCY_CONFLICT');
  check('conflict is NOT retried (attempts = 1)', r3.attempts === 1);

  console.log('== 4) Retry with X-Simulate-Error: rate-limit → 4 attempts then definitive failure ==');
  const r4 = await wf06({ idempotencyKey: 'h-retry', correlationId: 'cid-retry', body: validBody, simulate: 'rate-limit' });
  check('gives up after exactly 4 attempts', !r4.success && r4.attempts === 4, `status=${r4.status}`);
  check('same correlation id across all attempts', r4.sentCorrelation.size === 1);
  // WF99 emulation: persist the definitive failure
  const wf99 = await api('/api/v1/automation-failures', 'POST', {
    correlationId: 'cid-retry',
    workflowName: 'WF01 — Lead Intake',
    nodeName: 'Backend Lead Upsert',
    operation: 'LEAD_UPSERT',
    errorType: 'RATE_LIMIT',
    errorCode: r4.errorCode,
    statusCode: r4.status,
    retryable: true,
    attempt: r4.attempts,
    message: 'Backend rate limit exceeded after retries',
    payload: { source: 'landing-page', authorization: 'Bearer should-be-redacted' },
  });
  check('definitive failure persisted (201)', wf99.status === 201);
  check('WF99 payload sanitized (authorization redacted)', wf99.json?.data?.payload?.authorization === '[REDACTED]');

  console.log('== 5) Reprocess failed notification (WF07) — no upsert, sends e-mail ==');
  const created = await upsert({ idempotencyKey: 'h-ent', correlationId: 'cid-ent', body: enterpriseBody });
  const leadId = created.json.data.id;
  const updatedAtBefore = created.json.data.updatedAt;
  check('enterprise lead created', created.status === 201 && created.json.data.segment === 'enterprise');
  const failure = await api('/api/v1/automation-failures', 'POST', {
    correlationId: 'cid-ent',
    workflowName: 'WF01 — Lead Intake',
    nodeName: 'Notify Sales',
    operation: 'SEND_ENTERPRISE_NOTIFICATION',
    errorType: 'DEPENDENCY_UNAVAILABLE',
    retryable: true,
    attempt: 1,
    message: 'Enterprise notification failed',
    payload: { leadId },
  });
  const failureId = failure.json.data.id;
  const leadCountBefore = (await api('/api/v1/leads?page=1&limit=100')).json.pagination.total;
  // WF07 flow
  const load = await api(`/api/v1/automation-failures/${failureId}`);
  const reprocessable =
    load.json.data.operation === 'SEND_ENTERPRISE_NOTIFICATION' && load.json.data.status === 'OPEN';
  check('failure is reprocessable', reprocessable);
  await api(`/api/v1/automation-failures/${failureId}/reprocessing`, 'PATCH');
  const lead = await api(`/api/v1/leads/${leadId}`); // GET only, NO upsert
  check('lead loaded via GET (not upsert)', lead.status === 200);
  sendMail(`[LeadOps] Novo lead enterprise: ${lead.json.data.name}`, `Reprocessed. cid: cid-ent`);
  await sleep(500);
  const msgs = await mailpitMessages();
  const found = (msgs.messages ?? []).some((m) => m.Subject?.includes('Novo lead enterprise'));
  check('e-mail captured by Mailpit', found, `messages=${msgs.total ?? 0}`);
  await api(`/api/v1/leads/${leadId}/activities`, 'POST', {
    type: 'ENTERPRISE_NOTIFICATION_SENT',
    description: 'Reprocessed notification',
    metadata: { via: 'WF07' },
  });
  const resolved = await api(`/api/v1/automation-failures/${failureId}/resolve`, 'PATCH', {
    resolutionNote: 'Notification reprocessed successfully',
  });
  check('failure marked RESOLVED', resolved.json.data.status === 'RESOLVED');
  const leadAfter = await api(`/api/v1/leads/${leadId}`);
  check('lead NOT modified by reprocessing (updatedAt unchanged)', leadAfter.json.data.updatedAt === updatedAtBefore);
  const leadCountAfter = (await api('/api/v1/leads?page=1&limit=100')).json.pagination.total;
  check('reprocessing created NO new lead (count unchanged)', leadCountAfter === leadCountBefore, `before=${leadCountBefore} after=${leadCountAfter}`);

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
