# Reprocessing

Reprocessing re-runs **only a failed secondary operation** (an enterprise
notification) — never the primary upsert.

## What can be reprocessed

A failure is reprocessable only when **all** hold:

- `operation` is `SEND_ENTERPRISE_NOTIFICATION`;
- `status` is `OPEN`;
- the referenced lead still exists;
- the data needed to notify is available (lead id / e-mail).

Anything else (e.g. a `LEAD_UPSERT` failure, or an already-`RESOLVED` one) is
**not** reprocessable via this flow → `409`.

## Flow (WF07 — Reprocess Failed Notification)

```text
Manual Trigger / admin webhook  (input: { failureId })
  → GET /api/v1/automation-failures/:id        (load failure)
  → Reprocessable?  ── no ─▶ Respond 409
                    └─ yes
        → PATCH /:id/reprocessing               (status → REPROCESSING)
        → GET /api/v1/leads/:leadId             (load lead)
        → Execute WF05 — Notify Sales           (send e-mail only)
        → Success?
            ├─ yes → POST /:leadId/activities (ENTERPRISE_NOTIFICATION_SENT)
            │        → PATCH /:id/resolve (status → RESOLVED, note)
            └─ no  → keep OPEN / update attempt
```

## What must NOT be repeated

- **No upsert.** Reprocessing never calls `/api/v1/leads/upsert`. The lead already
  exists and is untouched.
- No re-scoring, no re-segmentation, no lead mutation.

## Correlation id

Prefer the **original** correlation id stored on the failure so the reprocessing
is traceable back to the initial run. If a fresh correlation id is minted for the
reprocessing run instead, record it in the resolution note / activity metadata so
both ids are linkable. (The activity created on success carries whichever
`X-Correlation-Id` the reprocessing request sends.)

## Resolving

On a successful notification, register an `ENTERPRISE_NOTIFICATION_SENT` activity
and `PATCH /:id/resolve` with a note (e.g. "Notification reprocessed
successfully"). The failure becomes `RESOLVED` with `resolvedAt` set.

## Limitations (Phase 3)

- Reprocessing is triggered manually (admin webhook / manual execution); there is
  no automatic scheduler.
- Only enterprise-notification failures are reprocessable; other operations would
  need their own, carefully idempotent, reprocessing flow.
