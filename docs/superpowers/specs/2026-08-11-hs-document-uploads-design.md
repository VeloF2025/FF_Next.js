# H&S document uploads — design

**Date:** 2026-08-11
**Status:** approved (Hein, 2026-08-11)
**Branch:** `feat/hs-document-uploads`

## Problem

The Health & Safety module captures documents as **free-text URLs**. On
`/health-safety/medicals/new` a medical fitness certificate is recorded by pasting
a link — the certificate itself never enters the system. The same is true of
contractor compliance documents and the safety library, while toolbox talks and
CAPA have photo columns with no upload UI at all.

Requirement: allow the file to be uploaded, across the whole module.

## Findings that shaped the design

### The storage proxy is unauthenticated

`/storage/` is an nginx proxy to VF Storage on port 8091 with no auth. Verified
live against a real stored staff document:

```
direct 8091:              200
public proxy (no cookie): 200   https://app.fibreflow.app/storage/staff/documents/<file>.pdf
```

Only `/storage/staff/payslips/` is blocked (`return 403`). Objects are served
`Cache-Control: public, immutable` for 30 days. Filenames are
`<epoch-ms>-<16 hex>`, so roughly 64 bits of entropy — not enumerable by
guessing, but the URL is a bearer token: anyone who obtains it keeps access, and
it is stored in the database and returned by some APIs.

This matters because a **medical fitness certificate is health data — POPIA
special personal information** (§26/§32), the most protected category under South
African law. Contractor compliance documents are close behind.

### Every affected table is empty

`hs_worker_medicals`, `hs_worker_training`, `hs_contractor_documents`,
`hs_safety_library`, `hs_toolbox_talks`, `hs_corrective_actions`,
`hs_appointment_letters` and `hs_permits` are all at **0 rows**. There is no
backfill, no expand/contract window, and no data-loss risk in changing how
documents are stored.

### The nginx config is version-controlled and current

`docs/VPS/vf-fibreflow.nginx.conf` is byte-identical to the live
`/etc/nginx/sites-enabled/vf-fibreflow`, so the private-prefix rule ships in this
PR — but applying it remains a manual server step.

## Scope

| Surface | Today | After |
|---|---|---|
| Medical fitness | URL box | upload only — URL box removed |
| Contractor documents | URL box | upload only — URL box removed |
| Safety library | URL box | URL box **and** upload |
| Toolbox talk photos | no UI | upload |
| CAPA evidence | display only | upload |
| Appointment letters | no column | upload (new capability) |
| Permits | no column | upload (new capability) |

Incidents, audits and training certificates already have working upload and are
**not touched**.

## Design

### Storage: one private tier for all new uploads

Hein chose a tiered model — existing public surfaces stay as they are. For the
seven new surfaces a single private path is *less* code than two, not more: one
component, one route, no branching on sensitivity. Photos still render normally,
because `<img src="/api/health-safety/attachments/download?id=…">` carries the
session cookie, so privacy costs nothing in UX.

- Bytes go to VF Storage under `hs-private/<surface>/`.
- nginx returns 403 for `^/storage/hs-private/`, the same guard already used for
  payslips.
- The database stores the **storage path**, never a public URL.
- Bytes are readable only through a download route that re-checks permission on
  every request.

### Data model: one table, real foreign keys

```sql
CREATE TABLE hs_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medical_id             uuid REFERENCES hs_worker_medicals(id)      ON DELETE CASCADE,
  contractor_document_id uuid REFERENCES hs_contractor_documents(id) ON DELETE CASCADE,
  library_id             uuid REFERENCES hs_safety_library(id)       ON DELETE CASCADE,
  talk_id                uuid REFERENCES hs_toolbox_talks(id)        ON DELETE CASCADE,
  capa_id                uuid REFERENCES hs_corrective_actions(id)   ON DELETE CASCADE,
  letter_id              uuid REFERENCES hs_appointment_letters(id)  ON DELETE CASCADE,
  permit_id              uuid REFERENCES hs_permits(id)              ON DELETE CASCADE,
  file_path   text    NOT NULL,
  file_name   text    NOT NULL,
  file_size   integer NOT NULL,
  mime_type   text    NOT NULL,
  uploaded_by uuid    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_attachments_exactly_one_parent CHECK (
      (medical_id IS NOT NULL)::int + (contractor_document_id IS NOT NULL)::int
    + (library_id IS NOT NULL)::int + (talk_id IS NOT NULL)::int
    + (capa_id IS NOT NULL)::int + (letter_id IS NOT NULL)::int
    + (permit_id IS NOT NULL)::int = 1
  )
);
```

Seven nullable foreign keys with an exclusive-arc CHECK, rather than a
polymorphic `(entity_type, entity_id)` pair. This module already has the
polymorphic shape in `hs_ticket_details`, and its own `.claude.md` flags it as
*"NO FK — orphans possible"*. Real foreign keys with `ON DELETE CASCADE` mean
deleting a medical record cannot strand a health-data file.

Not per-table columns either: that would be seven near-identical column sets and
seven separate places to get the permission check wrong. One table means one
download route to secure and one to test.

### Modules

Each has a single purpose and stays within the 300-line file / 200-line component
limits:

| Module | Responsibility |
|---|---|
| `hsAttachmentPolicy.ts` | Pure. Surface → storage category, parent column, parent table. No IO, so it is testable without a database — the same principle as `checkinClearance.ts`. |
| `hsAttachmentService.ts` | Reads and writes `hs_attachments`; verifies the parent row exists before insert. |
| `hsAttachmentValidation.ts` | Reuses `assertValidCertificateFile` (magic bytes, 10 MB) from the training-certificate path. |
| `attachments/index.ts` | `POST` multipart upload, `GET` list for one entity. |
| `attachments/download.ts` | `GET ?id=` — re-checks permission, then streams bytes. |
| `attachments/[attachmentId].ts` | `DELETE`, with storage compensation. |
| `HSAttachmentUpload.tsx` / `HSAttachmentList.tsx` | Shared UI for all seven surfaces. |

### Write ordering

Copied from the proven training-certificate route, because the handler owns two
resources that cannot commit together:

1. Authorize — an unauthorized caller never reaches storage.
2. Validate everything.
3. Check storage is available → 503 rather than a half-written submission.
4. Upload the object.
5. Insert the row.
6. On insert failure, delete the object. If that delete also fails, log the
   filename for an operator and withhold it from the response.

### Permissions

Reuse `withHsPermission`. **No new permission.** The medical outcome,
practitioner and practice number are already visible to anyone with H&S view, so
gating only the attachment behind a new permission would be theatre — and per the
training-certificate history, a new permission requires unblocking RBAC ancestors
with real blast radius. Narrowing medicals as a whole is worth doing, but as its
own piece of work.

### Legacy URL columns

`certificate_url` and `file_url` keep their columns — 0 rows, so nothing to
migrate. Code stops reading and writing them, and a guard test mirroring
`trainingRecordCertificateGuard.test.ts` stops them creeping back. Dropping the
columns is a separate contract migration.

## Rollout

The private tier is private **only** because of the nginx rule. If the
application deploys before nginx reloads, medical certificates are public.
Therefore:

1. Apply the nginx change and reload.
2. Run `scripts/verify-storage-privacy.sh` — it curls the private prefix and
   fails unless it returns 403.
3. Only then deploy the application.

The migration runs against the **shared** database, so a dev deploy applies it to
production data. It needs Hein's explicit go.

## Testing

- Pure policy unit tests.
- API tests: unauthorized upload rejected; download re-checks permission on every
  request; an id belonging to another entity 404s; oversized and wrong-magic-byte
  files rejected; an insert failure triggers storage compensation.
- Migration test asserting the exclusive-arc CHECK refuses both zero parents and
  two parents, **by constraint name**.
- Guard test that the medicals write path never emits `certificate_url`.
- `scripts/verify-storage-privacy.sh` proves the 403.

**Done means:** a PDF uploaded on `/health-safety/medicals/new` on dev produces a
row and a stored file; the bytes return **403 on the public URL**, **200 through
the download route** as a permitted user, and **403** as a non-permitted user;
`npm run ci:quick` is green.

## Out of scope — reported, not fixed

- `/storage/staff/documents/` is publicly readable and holds **190 live
  documents**, including training certificates. Needs its own decision — and see
  the caching note below, which limits what a later fix can achieve.
- **Deletion is not revocation on the public tier.** Measured against a probe
  object: after deleting it, the origin returned 404 while the public URL still
  returned 200, and only a cache-busted query string returned 404. Objects are
  served `public, immutable` for 30 days, so a document deleted from the public
  tier stays retrievable at the edge until the TTL expires. This costs nothing
  for `hs-private/`, which is new and has never served a cacheable 200 — the
  first request 403s, so nothing is ever cached. It does mean that closing the
  `staff/documents/` hole later cannot retract copies already cached.
- `/api/storage/upload` is `withAuth` only and takes `type`/`category` from the
  client, so any signed-in user can write into any storage category, including
  `staff/payslips`. Storage litter rather than a read hole, since nothing links
  those objects to a record.
- Incident and audit photos remain on the public tier, matching existing
  behaviour. A CAPA or incident photo can show an injured person; worth revisiting.
