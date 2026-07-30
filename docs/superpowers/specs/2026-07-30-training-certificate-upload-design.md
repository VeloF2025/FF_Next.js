# Classified Training Certificate Upload Design

**Date:** 2026-07-30
**Status:** Approved for specification
**Scope:** Internal employee training-certificate upload, verification, secure storage, and H&S competency linkage

## Objective

Provide one secure training-certificate upload flow while preserving separate,
queryable competencies such as Working at Heights, Fibre Splicing, OTDR
Testing, Blown Fibre Installation, and Aerial Fibre Installation.

The file must be stored once in the employee's HR document record. One or more
pending H&S training records reference that file. Only verified records affect
competency status or a contractor gate.

Version one is operated by appointed HR/H&S custodians. Employee self-submission
and contractor-worker certificate upload are later extensions.

## Decisions

1. Use one upload workflow, not a separate uploader per competency.
2. Require at least one active `hs_training_types` selection.
3. Store the file once as `staff_documents.document_type = 'certification'`.
4. Link one file to one or more `hs_worker_training` records.
5. Replace free-text certificate URLs with a protected `staff_document_id`
   reference for new records.
6. Create training records as `pending`; only `verified` records count as
   current, expiring, or expired for reporting and gates.
7. Keep the first release internal-staff-only because the live contractor roster
   is not authoritative.
8. Restrict upload, binary access, and verification with a dedicated permission;
   broad H&S view permission may see competency status but not the certificate
   file.

## Existing System

- `staff_documents` stores employee files in VF Storage and already supports the
  `certification` document type.
- `hs_training_types` is the managed competency catalogue, including statutory
  status, whether a certificate is required, and an optional default validity
  period.
- `hs_worker_training` stores one worker/competency record and derives competency
  status from `expiry_date`.
- `/health-safety/training/new` currently records one training type and accepts a
  free-text `certificate_url`; it does not upload a file.
- The contractor gate calculates its training score from all current
  `hs_worker_training` rows. It must be changed to consider verified rows only.
- Direct staff-document upload, read, update, delete, verify, download, and
  expiring-document APIs currently authenticate callers but do not consistently
  enforce the existing sensitive-document helpers.

## Competency Catalogue

Working at Heights and the other statutory construction types remain the seeded
catalogue from migration 451.

Add these initial non-statutory fibre competencies:

| Code | Name | Default validity |
|---|---|---:|
| `fibre_splicing` | Fibre Splicing | None |
| `otdr_testing` | OTDR Testing | None |
| `blown_fibre_installation` | Blown Fibre Installation | None |
| `aerial_fibre_installation` | Aerial Fibre Installation | None |

`None` means the system uses the explicit expiry printed on the certificate
when supplied; otherwise the record does not expire. No unsupported validity
period is invented. Administrators can add future competencies through the
existing training-type catalogue instead of requiring new upload code.

## Data Model

Use an additive migration with the next unused repository migration number.

Add to `hs_worker_training`:

- `staff_document_id uuid NULL REFERENCES staff_documents(id) ON DELETE RESTRICT`
- `verification_status varchar(16) NOT NULL DEFAULT 'pending'`
- `verified_by uuid NULL REFERENCES users(id) ON DELETE SET NULL`
- `verified_at timestamptz NULL`
- `rejection_reason text NULL`
- `revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL`
- `revoked_at timestamptz NULL`
- `revocation_reason text NULL`

Allowed statuses are `pending`, `verified`, `rejected`, and `revoked`.

Migration behavior:

- Extend the `staff_documents.verification_status` constraint to accept
  `revoked`. Its existing `expired` state remains valid.
- Change the staff-document expiry updater so it transitions only eligible
  pending/verified documents to `expired`; it must never overwrite `rejected`
  or `revoked`.
- Backfill existing `hs_worker_training` rows to `verified`, because existing
  manually entered records were already treated as accepted evidence.
- Add a unique partial index on
  `(staff_document_id, training_type_id)` where `staff_document_id IS NOT NULL`.
- Add an index supporting status-aware gate reads:
  `(contractor_id, verification_status, expiry_date)`.
- Add a partial functional uniqueness constraint on the certification document,
  not the per-type training rows: employee + normalized nonblank certificate
  number + normalized nonblank provider must be unique while the document is
  pending or verified. The migration preflight reports any live conflicts
  before creating the index.
- Retain `certificate_url` only for legacy rows. New upload and read paths do
  not write or expose it.

One uploaded document can therefore support several competencies without
duplicating the binary file. Each competency can retain its own dates if a
future certificate requires that; version one applies the submitted dates and
provider to every selected competency. When the user leaves expiry blank, each
selected type derives its own expiry from its catalogue validity period.

Deleting a pending or rejected submission removes its linked training rows
inside the same database transaction before deleting the document. A verified
or revoked submission is immutable through the delete endpoint. A mistaken or
withdrawn verification is revoked with a required reason; a corrected
certificate is uploaded as a new submission.

## Permission Model

Add `people.staff.training-certificates` beneath `people.staff`.

- `view`: see certificate metadata and download the file.
- `create`: upload a certificate and create pending competency records.
- `edit`: verify or reject a submission.
- `delete`: delete only when no verified training record references the file.

Only `super_admin` receives the initial role grant. Named custodians are added
through explicit user overrides after the owner selects them. No manager,
technician, viewer, contractor, or generic admin grant is seeded.
Any named override also requires view access to the `people` and `people.staff`
ancestors because the existing RBAC service fails closed on a blocked ancestor.

H&S users with `projects.health-safety` view may see:

- worker name;
- competency type;
- completion and expiry dates;
- verification and competency status.

They may not receive `file_url`, `file_path`, or the document binary unless they
also have `people.staff.training-certificates:view`.

The implementation must enforce permissions inside every direct staff-document
API using `canAccessStaffDocuments`, `canUploadStaffDocument`, and
`canApproveDocuments`, extended where necessary for the dedicated certificate
permission. UI visibility is not an authorization control.

## User Experience

### Entry points

1. Employee profile → Documents → **Upload training certificate**
2. H&S → Training → **Upload certificate**

Both entry points use the same focused workflow. The employee profile supplies
the employee automatically; the H&S entry point begins with employee selection.
No sidebar is added.

### Steps

1. Select employee when not already known.
2. Select and validate a PDF, JPG, PNG, or Word file up to 10 MB.
3. Select one or more active training types.
4. Enter certificate number, provider, completion date, and optional explicit
   expiry date.
5. Review the employee, file, competencies, and dates.
6. Submit as pending.

The list displays a single document with its linked competency chips. A verifier
opens the document through the protected download endpoint, then chooses
**Verify** or **Reject**. Rejection requires a reason.

A verifier may revoke previously verified evidence with a mandatory reason.
Revocation immediately removes it from competency and gate calculations while
retaining the document and full audit history.

The existing `/health-safety/training/new` page remains for recording
non-certificate training types such as an induction whose catalogue entry has
`requires_certificate = false`. Certificate-required types direct the user to
the upload flow and no longer offer a free-text URL.

## API and Service Boundaries

### Upload

Create `POST /api/staff-training-certificates-upload` as a flattened multipart
route.

The route:

1. authenticates the caller;
2. requires `people.staff.training-certificates:create`;
3. validates the employee, file, selected active types, and metadata;
4. uploads the file to VF Storage;
5. uses `pg.Pool` in one database transaction to insert the `staff_documents`
   row and all pending `hs_worker_training` rows;
6. deletes the uploaded VF Storage object if the database transaction fails;
7. records staff-document and H&S activity after the main write.

### Verification

Secure the existing
`POST /api/staff-documents/[documentId]/verify` route and extend its
`certification` branch.

In one database transaction it:

1. locks the staff document and linked training rows;
2. verifies that the document is pending and linked to at least one training
   record;
3. updates the staff document and all linked training records to `verified` or
   `rejected`;
4. records verifier, time, and rejection reason;
5. commits before emitting audit activity.

The same secured service supports `verified` to `revoked`, requiring a reason
and recording actor and timestamp. No other terminal-state transition is
accepted.

If a future contractor-linked record is verified, recompute affected contractor
training scores after commit. Version one does not expose contractor-worker
selection.

### Reads and downloads

- Training list APIs omit storage paths and legacy certificate URLs.
- A protected download endpoint resolves `staff_document_id` server-side after
  a permission check.
- The training matrix filters gate and competency calculations to
  `verification_status = 'verified'`.
- A pending, rejected, or revoked submission never improves a gate score.

## Validation and Failure Handling

- Reject missing employee, file, training types, or completion date.
- Reject inactive or unknown training types.
- Reject an expiry date before the completion date.
- Reject unsupported MIME types, magic-byte mismatches, and files over 10 MB.
- Reject duplicate training types in one submission.
- Reject a duplicate nonblank certificate number for the same employee and
  provider, case-insensitively. A renewal must have a new certificate number or
  an explicit verifier-approved correction to the existing submission.
- Fail closed on permission lookup errors.
- Do not show a success notification before the API confirms both document and
  pending training rows.
- If storage succeeds and the database transaction fails, perform a
  compensating storage delete and return an error.
- If the compensating delete fails, log the orphan path without returning it to
  the browser and surface an operational cleanup alert.
- Verification or revocation is idempotent for the same terminal state; conflicting
  re-verification returns `409`.

## Auditing

- Reuse the staff document audit service for upload, view, download, verify,
  reject, and delete events.
- Use `logHsActivity()` after successful training-state writes.
- Do not place certificate contents, medical information, storage URLs, or
  document numbers in general application logs.
- Audit records contain actor, employee, document id, selected training type
  ids, state transition, and timestamp.

## Out of Scope

- Medical-certificate upload or synchronization.
- Employee self-submission.
- Contractor-worker certificate capture until an authoritative contractor
  roster exists.
- Bulk certificate import.
- OCR or automatic classification of training certificates.
- Changing which named employees are the operational custodians; the owner
  assigns those user overrides separately.

## Testing

### Unit and API tests

- Single-type and multi-type submission mapping.
- Explicit expiry, catalogue-derived expiry, and no-expiry behavior.
- Duplicate-type and duplicate-certificate rejection.
- Pending and rejected rows excluded from competency and gate calculations.
- Verified rows included exactly once.
- Storage cleanup after database failure.
- Verification idempotency and conflicting-state `409`.
- Revocation removes previously verified evidence from competency and gate
  calculations without deleting audit history.
- File/path fields omitted from non-sensitive H&S responses.

### Authorization tests

For upload, metadata read, binary download, update, delete, verify, and expiring
document routes:

- unauthenticated returns `401`;
- authenticated without permission returns `403`;
- H&S-view-only cannot download;
- create-only can submit but cannot verify;
- edit can verify/reject;
- super admin succeeds;
- a caller cannot substitute another employee id to bypass authorization.

### UI tests

- Employee-profile entry preselects the employee.
- H&S entry requires employee selection.
- Multi-select competencies render in review and list views.
- Certificate-required types redirect away from free-text URL entry.
- Success appears only after the API response.
- Restricted users do not see upload, download, or verify actions.

### Dev proof with throwaway data

After the additive migration is explicitly approved:

1. create a uniquely named throwaway employee;
2. upload a harmless generated PDF for Working at Heights and Fibre Splicing;
3. prove two pending records reference one staff document;
4. prove pending records do not count in competency/gate queries;
5. verify the document and prove both records become effective;
6. prove an unauthorized session receives `403`;
7. delete every generated row and VF Storage object;
8. independently query the shared database to prove cleanup.

Because dev and production share one database, the proof uses uniquely prefixed
records, runs for the shortest practical interval, and leaves an explicit
before/after cleanup record.

## Deployment

- Code changes go through a pull request from a fresh worktree.
- Run focused tests, `npm run ci:quick`, the H&S test set, and UI verification.
- The additive migration changes the shared dev/production database and requires
  explicit owner confirmation immediately before execution.
- Deploy to dev with `bash scripts/deploy-local.sh dev`.
- Verify upload, authorization, verification, competency status, storage
  cleanup, and database readback on dev.
- Production deployment remains separately approval-gated and must use
  `bash scripts/deploy-local.sh production` inside the allowed window.

## Acceptance Criteria

1. A custodian uploads one employee certificate and classifies it under one or
   more training types.
2. Exactly one `staff_documents` row stores the file.
3. Each selected training type creates exactly one linked pending
   `hs_worker_training` row.
4. Pending, rejected, and revoked rows never count as valid competency evidence.
5. Verification atomically activates all linked rows.
6. H&S viewers can see competency status without seeing storage paths or file
   contents.
7. Every direct staff-document endpoint enforces server-side authorization.
8. Working at Heights remains a separate statutory competency; fibre
   competencies use the same uploader and separate catalogue entries.
9. Throwaway dev data and files are completely removed after verification.
