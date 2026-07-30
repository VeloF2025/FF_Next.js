# Classified Training Certificate Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one secure internal-employee training-certificate upload and verification workflow that stores one HR document, links it to one or more H&S competencies, and lets only verified evidence affect competency and gate results.

**Architecture:** A focused multipart API uploads one file to VF Storage, then uses `pg.Pool` transaction support to create one `staff_documents` row and one pending `hs_worker_training` row per selected type. Type-aware staff-document authorization protects metadata and binaries, while a transactional lifecycle service verifies, rejects, revokes, or deletes the linked submission as one unit. Shared React components expose the workflow from the staff document list and H&S training module without duplicating upload logic.

**Tech Stack:** Next.js Pages Router, React, TypeScript, PostgreSQL via `pg.Pool`, VF Storage, Formidable, Vitest, Testing Library, `node-mocks-http`, Playwright/browser verification.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-30-training-certificate-upload-design.md`; do not change its scope without Hein's approval.
- Version one supports internal `staff` employees only; employee self-submission and contractor-worker upload remain out of scope.
- One uploaded binary creates exactly one `staff_documents` row with `document_type = 'certification'` and one linked `hs_worker_training` row per selected active type.
- New linked training rows start `pending`; only `verified` rows affect competency, expiry reporting, or contractor gate calculations.
- Use `people.staff.training-certificates` for certificate metadata, upload, download, verification, rejection, revocation, and eligible deletion.
- Grant the new permission to `super_admin` only. Named user overrides require a separate explicit owner decision and must also satisfy the `people` and `people.staff` ancestor permissions.
- Never return `file_path`, `file_url`, or legacy `certificate_url` from an H&S training response.
- New database work uses `transaction(callback)` and `TxnClient` from `src/lib/db-pool.ts`; do not use the Neon shim for multi-statement writes.
- The dev and production applications share one PostgreSQL database. Writing the migration files is allowed; applying them, or deploying a commit that auto-applies them, requires Hein's explicit confirmation immediately beforehand.
- The provisional migration number is `471`. Before writing or merging, fetch `origin/master`; if `471` exists, rename the forward and rollback files to the next unused number and update their `schema_migrations` filename.
- All changes use this feature branch and a pull request. Merging into `master` requires explicit confirmation under the repository rules.
- No production deployment is part of this plan.
- Validate PDF, JPEG, PNG, DOC, and DOCX by MIME type and magic bytes; maximum upload size is 10 MB.
- Do not log certificate numbers, binary contents, medical information, storage URLs, or storage paths.
- New files remain below 300 lines and new React components below 200 lines. Use `log`/`createLogger`, never `console.log`.
- Execute this plan inline with `superpowers:executing-plans`; do not spawn subagents unless the user explicitly requests delegation.

## File Map

### Create

- `scripts/migrations/sql/471_hs_training_certificate_upload.sql` — additive schema, catalogue, permission, backfill, indexes, and expiry-function changes.
- `scripts/migrations/sql/rollback_471_hs_training_certificate_upload.sql` — reversible schema and seed rollback with safe state mapping.
- `scripts/migrations/sql/preflight_471_hs_training_certificate_upload.sql` — read-only duplicate and dependency counts to run before the shared migration.
- `src/modules/health-safety/services/trainingCertificateService.ts` — expiry resolution, transactional submission creation, lifecycle transitions, and linked deletion.
- `src/modules/health-safety/services/trainingCertificateValidation.ts` — multipart field normalization and file/type/date validation.
- `src/modules/health-safety/components/training/TrainingCertificateUploadForm.tsx` — controlled workflow and review/submit state.
- `src/modules/health-safety/components/training/TrainingCertificateFields.tsx` — file and certificate metadata fields.
- `src/modules/health-safety/components/training/TrainingTypeMultiSelect.tsx` — active-type multi-select and selected chips.
- `src/modules/health-safety/components/training/TrainingCertificateUploadDialog.tsx` — staff-profile modal wrapper with fixed `staffId`.
- `pages/health-safety/training/certificates/new.tsx` — H&S entry point with employee selection and `ModulePage`.
- `pages/api/staff-training-certificates-upload.ts` — flattened multipart upload route.
- `src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts` — schema contract and rollback ratchet.
- `src/modules/health-safety/__tests__/trainingCertificateService.test.ts` — mapping, expiry, duplicate, transaction, transition, and deletion tests.
- `src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts` — upload validation, authorization, storage compensation, and response tests.
- `src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts` — verify/reject/revoke/idempotency/conflict tests.
- `src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx` — both entry points and success timing.
- `src/services/staff/__tests__/staffDocumentAccess.test.ts` — type-aware permission helper tests.
- `src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts` — direct endpoint authorization matrix.

### Modify

- `src/types/staff/access.types.ts` — new permission constant.
- `src/types/staff-document.types.ts` — add `revoked` and linked competency metadata to public document types.
- `src/modules/health-safety/types/training.types.ts` — verification fields and storage-safe training view.
- `src/services/staff/staffAccessService.ts` — dedicated certificate actions and type-aware document helpers.
- `src/services/staff/staffAuditService.ts` — `document_revoked` action and helper.
- `src/modules/health-safety/services/trainingService.ts` — verified-only contractor score.
- `pages/api/health-safety/training/records/index.ts` — safe reads and manual no-certificate-only creation.
- `pages/api/staff-documents-upload.ts` — server-side generic upload authorization.
- `pages/api/staff/[staffId]/documents.ts` — full/self/certificate-only branches and safe response projection.
- `pages/api/staff-documents/[documentId].ts` — action authorization and linked lifecycle-aware delete.
- `pages/api/staff-documents/[documentId]/verify.ts` — action authorization and certification lifecycle delegation.
- `pages/api/staff-documents-download.ts` — protected binary resolution.
- `pages/api/staff-documents/expiring.ts` — authorized scope and storage-safe response.
- `pages/health-safety/training/index.tsx` — upload entry and verification/competency presentation.
- `pages/health-safety/training/new.tsx` — no-certificate manual records only; remove URL input.
- `src/components/staff/StaffDocumentList.tsx` — focused training upload button/dialog and linked competency chips.
- `src/modules/health-safety/.claude.md` — short route, permission, and verified-only rules.
- `.claude/modules/health-safety.md` — full operational and data-model documentation.

---

### Task 1: Add the additive schema and migration safety ratchet

**Files:**

- Create: `scripts/migrations/sql/471_hs_training_certificate_upload.sql`
- Create: `scripts/migrations/sql/rollback_471_hs_training_certificate_upload.sql`
- Create: `scripts/migrations/sql/preflight_471_hs_training_certificate_upload.sql`
- Create: `src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts`

**Interfaces:**

- Consumes: existing `staff_documents`, `hs_training_types`, `hs_worker_training`, `access_permissions`, `role_permissions`, and `schema_migrations`.
- Produces: `hs_worker_training.staff_document_id`, lifecycle columns, verified-only indexes, four fibre type rows, `people.staff.training-certificates`, and a rollback that restores the previous schema.

- [x] **Step 1: Confirm the migration number and current source schemas**

Run:

```bash
git fetch origin
find scripts/migrations/sql -maxdepth 1 -type f -printf '%f\n' | sort -V | tail -20
rg -n "CREATE TABLE IF NOT EXISTS hs_worker_training|chk_verification_status|update_expired_documents" \
  scripts/migrations/sql/451_hs_training_matrix.sql \
  scripts/migrations/create-staff-documents-tables.sql
```

Expected: `470` is the highest forward migration. If another `471_*.sql` exists, use the next unused number consistently instead of `471`.

- [x] **Step 2: Write the failing schema-contract test**

The test must read the forward, rollback, and preflight SQL and assert these exact contracts:

```typescript
expect(forward).toContain('staff_document_id');
expect(forward).toContain("verification_status IN ('pending', 'verified', 'rejected', 'revoked')");
expect(forward).toContain("verification_status IN ('pending', 'verified', 'rejected', 'expired', 'revoked')");
expect(forward).toContain('WHERE staff_document_id IS NOT NULL');
expect(forward).toContain("'people.staff.training-certificates'");
expect(forward).toContain("'super_admin'");
expect(forward).not.toMatch(/'admin'\\s*,\\s*'people\\.staff\\.training-certificates'/);
expect(forward).toContain("'fibre_splicing'");
expect(forward).toContain("'otdr_testing'");
expect(preflight).toContain('duplicate_certification_count');
expect(rollback).toContain("SET verification_status = 'rejected'");
expect(rollback).toContain('DROP COLUMN IF EXISTS staff_document_id');
```

- [x] **Step 3: Run the schema-contract test and verify red**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts
```

Expected: FAIL because the three SQL files do not exist.

- [x] **Step 4: Write the read-only preflight**

Make the preflight return named counts without modifying data:

```sql
SELECT COUNT(*) AS duplicate_certification_count
FROM (
  SELECT staff_id, LOWER(BTRIM(document_number)), LOWER(BTRIM(issuing_authority))
  FROM staff_documents
  WHERE document_type = 'certification'
    AND verification_status IN ('pending', 'verified')
    AND NULLIF(BTRIM(document_number), '') IS NOT NULL
    AND NULLIF(BTRIM(issuing_authority), '') IS NOT NULL
  GROUP BY staff_id, LOWER(BTRIM(document_number)), LOWER(BTRIM(issuing_authority))
  HAVING COUNT(*) > 1
) conflicts;

SELECT COUNT(*) AS existing_training_count FROM hs_worker_training;
SELECT COUNT(*) AS revoked_staff_document_count
FROM staff_documents WHERE verification_status = 'revoked';
```

- [x] **Step 5: Write the additive forward migration**

The migration must:

```sql
ALTER TABLE hs_worker_training
  ADD COLUMN IF NOT EXISTS staff_document_id uuid
    REFERENCES staff_documents(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS verification_status varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;
```

It must also:

- backfill every pre-existing training row to `verified` before adding the lifecycle check;
- add a named lifecycle `CHECK` constraint;
- extend the staff-document status constraint with `revoked`, retaining `expired`;
- replace `update_expired_documents()` so only `pending`/`verified` records become `expired`;
- add unique `(staff_document_id, training_type_id)` where the document id is non-null;
- add `(contractor_id, verification_status, expiry_date)`;
- add the case-insensitive, nonblank, pending/verified certification uniqueness index on staff id, document number, and issuing authority;
- seed `fibre_splicing`, `otdr_testing`, `blown_fibre_installation`, and `aerial_fibre_installation` with `validity_months = NULL`;
- register `people.staff.training-certificates` under `people.staff`;
- grant `{view,create,edit,delete}` only to `super_admin`;
- insert its own filename into `schema_migrations` using the repository's current convention.

- [x] **Step 6: Write the rollback**

The rollback must first preserve terminal state:

```sql
UPDATE staff_documents
SET verification_status = 'rejected',
    verification_notes = CONCAT_WS(
      E'\n',
      NULLIF(verification_notes, ''),
      '[rollback] revoked training certificate retained as rejected'
    )
WHERE verification_status = 'revoked';
```

Then restore the previous staff status constraint and expiry function, remove the new role and access permission, delete only unused seeded fibre types, drop new indexes and lifecycle constraint, drop new training columns, and delete the migration filename from `schema_migrations`.

- [x] **Step 7: Run schema tests and a throwaway PostgreSQL apply/rollback proof**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts
```

Then use a disposable PostgreSQL database containing the prerequisite tables, apply the forward migration twice, apply the rollback once, and query `information_schema.columns` plus `pg_indexes`.

Expected: test PASS; both forward applications succeed; rollback succeeds; no new column/index remains after rollback. Do not connect this proof to the shared FibreFlow database.

- [x] **Step 8: Commit the schema unit**

```bash
git add scripts/migrations/sql/471_hs_training_certificate_upload.sql \
  scripts/migrations/sql/rollback_471_hs_training_certificate_upload.sql \
  scripts/migrations/sql/preflight_471_hs_training_certificate_upload.sql \
  src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts
git commit -m "feat(hs): add training certificate schema"
```

---

### Task 2: Implement the training-certificate domain service

**Files:**

- Create: `src/modules/health-safety/services/trainingCertificateService.ts`
- Create: `src/modules/health-safety/services/trainingCertificateValidation.ts`
- Create: `src/modules/health-safety/__tests__/trainingCertificateService.test.ts`
- Modify: `src/modules/health-safety/types/training.types.ts`
- Modify: `src/types/staff-document.types.ts`

**Interfaces:**

- Consumes: `TxnClient` from `@/lib/db-pool`, selected `HSTrainingType` rows, and VF Storage metadata.
- Produces:

```typescript
export type TrainingVerificationStatus = 'pending' | 'verified' | 'rejected' | 'revoked';

export interface CreateTrainingCertificateInput {
  staffId: string;
  trainingTypeIds: string[];
  certificateNumber: string;
  provider: string;
  completedDate: string;
  explicitExpiryDate: string | null;
  fileName: string;
  filePath: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  actorUserId: string;
}

export interface TrainingCertificateSubmissionResult {
  documentId: string;
  trainingRecordIds: string[];
  verificationStatus: 'pending';
}

export async function createTrainingCertificateSubmission(
  txn: TxnClient,
  input: CreateTrainingCertificateInput
): Promise<TrainingCertificateSubmissionResult>;

export function resolveTrainingExpiry(
  completedDate: string,
  explicitExpiryDate: string | null,
  validityMonths: number | null
): string | null;
```

- [x] **Step 1: Write failing unit cases for mapping and expiry**

Cover one type, multiple types, duplicate input ids, explicit expiry, catalogue-derived expiry, no expiry, inactive/unknown type, duplicate certificate, and expiry before completion. Assert all linked rows use the same returned document id and start pending.

- [x] **Step 2: Run the service test and verify red**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateService.test.ts
```

Expected: FAIL because the service modules and lifecycle types do not exist.

- [x] **Step 3: Add storage-safe types**

Add the lifecycle fields to `HSWorkerTraining`, replace new-response reliance on `certificate_url` with `staff_document_id`, and add:

```typescript
export interface LinkedTrainingTypeSummary {
  id: string;
  code: string;
  name: string;
  verificationStatus: TrainingVerificationStatus;
}
```

Extend staff document status to include `revoked`; public document shapes expose `downloadUrl?: string` and `trainingTypes?: LinkedTrainingTypeSummary[]`, never a raw path.

- [x] **Step 4: Implement pure validation and expiry resolution**

Use UTC calendar arithmetic, reject invalid ISO dates, and clamp month addition to the last valid day of the target month. Normalize training type ids with `trim()` and reject rather than silently discard duplicates.

- [x] **Step 5: Implement transactional submission creation**

Within the caller-provided transaction:

1. lock and validate the staff row;
2. load every selected active training type and prove the count matches;
3. perform the normalized pending/verified duplicate certificate check;
4. insert one `staff_documents` certification row using provider as `issuing_authority`;
5. insert one pending `hs_worker_training` row per type, deriving expiry independently;
6. return only ids and status.

Use parameterized `TxnClient.query` calls and no storage operation inside the service.

- [x] **Step 6: Run the focused tests**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateService.test.ts
npm run type-check
```

Expected: PASS.

- [x] **Step 7: Commit the domain unit**

```bash
git add src/modules/health-safety/services/trainingCertificateService.ts \
  src/modules/health-safety/services/trainingCertificateValidation.ts \
  src/modules/health-safety/__tests__/trainingCertificateService.test.ts \
  src/modules/health-safety/types/training.types.ts \
  src/types/staff-document.types.ts
git commit -m "feat(hs): add training certificate domain service"
```

---

### Task 3: Enforce type-aware staff-document authorization

**Files:**

- Modify: `src/types/staff/access.types.ts`
- Modify: `src/services/staff/staffAccessService.ts`
- Create: `src/services/staff/__tests__/staffDocumentAccess.test.ts`
- Create: `src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts`
- Modify: `pages/api/staff-documents-upload.ts`
- Modify: `pages/api/staff/[staffId]/documents.ts`
- Modify: `pages/api/staff-documents/[documentId].ts`
- Modify: `pages/api/staff-documents/[documentId]/verify.ts`
- Modify: `pages/api/staff-documents-download.ts`
- Modify: `pages/api/staff-documents/expiring.ts`

**Interfaces:**

- Produces:

```typescript
export const STAFF_TRAINING_CERTIFICATES_PERMISSION =
  'people.staff.training-certificates';

export async function canAccessTrainingCertificates(userId: string): Promise<boolean>;
export async function canCreateTrainingCertificates(userId: string): Promise<boolean>;
export async function canEditTrainingCertificates(userId: string): Promise<boolean>;
export async function canDeleteTrainingCertificates(userId: string): Promise<boolean>;
export async function canAccessStaffDocument(
  userId: string,
  targetStaffId: string,
  documentType: string
): Promise<boolean>;
export async function canDeleteStaffDocument(
  userId: string,
  targetStaffId: string,
  documentType: string
): Promise<boolean>;
```

`canUploadStaffDocument` remains the common upload interface: certification delegates to the dedicated `create` permission and does not allow self-upload. `canApproveDocuments(userId, documentType?)` delegates certification to dedicated `edit`, while other document types keep the existing sensitive rule.

- [x] **Step 1: Write the failing helper authorization matrix**

Test sensitive HR access, employee self-access, training view/create/edit/delete actions, a training-only user, and a permission lookup rejection. Every lookup error must resolve to `false`.

- [x] **Step 2: Write failing direct-route tests**

With `node-mocks-http`, cover unauthenticated `401`, authenticated unauthorized `403`, H&S-view-only download `403`, create-only upload allowed but verify denied, edit verification allowed, and super-admin success for upload/list/detail/download/update/delete/verify/expiring routes.

- [x] **Step 3: Run the two authorization tests and verify red**

Run:

```bash
npx vitest run \
  src/services/staff/__tests__/staffDocumentAccess.test.ts \
  src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts
```

Expected: FAIL because the dedicated helpers are absent and current direct routes only authenticate.

- [x] **Step 4: Implement the fail-closed helpers**

Call `userHasPermission(userId, STAFF_TRAINING_CERTIFICATES_PERMISSION, action)` inside `try/catch`; log a non-sensitive error and return false. Preserve full HR and employee-self behavior for non-certification documents.

- [x] **Step 5: Guard generic upload, detail, update, delete, verify, and download**

Each route must use `AuthenticatedNextApiRequest`, resolve the document's `staff_id` and `document_type` before the action, then call the type-aware helper. Do not authorize from request-supplied `staffId` alone.

- [x] **Step 6: Guard list and expiring queries without leaking other HR documents**

Use explicit query branches:

- full HR/self: existing allowed scope;
- training-certificate view only: `document_type = 'certification'`;
- neither: `403`.

Return `downloadUrl: /api/staff-documents-download?documentId=<id>` only when the caller has binary access. Remove `file_path` and `file_url` from JSON projections in every branch.

- [x] **Step 7: Run authorization tests**

Run:

```bash
npx vitest run \
  src/services/staff/__tests__/staffDocumentAccess.test.ts \
  src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts
npm run type-check
```

Expected: PASS.

- [x] **Step 8: Commit the authorization unit**

```bash
git add src/types/staff/access.types.ts \
  src/services/staff/staffAccessService.ts \
  src/services/staff/__tests__/staffDocumentAccess.test.ts \
  src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts \
  pages/api/staff-documents-upload.ts \
  pages/api/staff/[staffId]/documents.ts \
  pages/api/staff-documents/[documentId].ts \
  pages/api/staff-documents/[documentId]/verify.ts \
  pages/api/staff-documents-download.ts \
  pages/api/staff-documents/expiring.ts
git commit -m "fix(staff): enforce document authorization"
```

---

### Task 4: Build the atomic multipart upload API

**Files:**

- Create: `pages/api/staff-training-certificates-upload.ts`
- Create: `src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts`
- Modify: `src/services/staff/staffAuditService.ts`

**Interfaces:**

- Consumes: `canCreateTrainingCertificates`, `uploadStaffDocument`, `deleteStaffDocument`, `transaction`, `createTrainingCertificateSubmission`, and `logHsActivity`.
- Produces: `POST /api/staff-training-certificates-upload` with `multipart/form-data` fields `staffId`, repeated or JSON `trainingTypeIds`, `certificateNumber`, `provider`, `completedDate`, optional `expiryDate`, and `file`.

- [x] **Step 1: Write failing route tests**

Cover:

- missing permission `403` before storage;
- missing employee/file/types/completion date `400`;
- unsupported extension/MIME/magic-byte mismatch/over 10 MB `400`;
- duplicate type ids and expiry before completion `400`;
- storage unavailable `503`;
- one type and multiple types `201`;
- DB failure after upload calls `deleteStaffDocument` with the uploaded filename;
- compensating delete failure logs an orphan cleanup alert without returning its path;
- response contains document id, training record ids, and pending status only.

- [x] **Step 2: Run the API test and verify red**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts
```

Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement multipart parsing and file validation**

Export:

```typescript
export const config = {
  api: { bodyParser: false, responseLimit: '10mb' },
};
```

Use Formidable with a 10 MB limit, read exactly one file, require the allowed MIME/extension pair, and validate PDF/JPEG/PNG/OLE/ZIP magic bytes. Accept ZIP magic only when the extension and MIME identify DOCX.

- [x] **Step 4: Implement storage plus database compensation**

The handler sequence is exact:

```typescript
const uploaded = await uploadStaffDocument(
  input.staffId,
  fileBuffer,
  file.originalFilename,
  'certification'
);
try {
  result = await transaction((txn) =>
    createTrainingCertificateSubmission(txn, {
      ...input,
      fileName: uploaded.filename,
      filePath: uploaded.path,
      fileUrl: uploaded.url,
      fileSize: uploaded.size,
      mimeType: file.mimetype,
      actorUserId: req.user.id,
    })
  );
} catch (error) {
  const deleted = await deleteStaffDocument(input.staffId, uploaded.filename);
  if (!deleted) logger.error('Orphaned training certificate requires cleanup', {
    staffId: input.staffId,
    fileName: uploaded.filename,
  });
  throw error;
}
```

Never include `uploaded.path` or `uploaded.url` in the response or audit details.

- [x] **Step 5: Emit audit events after commit**

Use `logDocumentUploaded` and `logHsActivity` after the transaction succeeds. Audit details contain actor, employee, document id, selected type ids, `pending`, and timestamp; general application logs omit document number and provider.

- [x] **Step 6: Run upload tests and type-check**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts
npm run type-check
```

Expected: PASS.

- [x] **Step 7: Commit the upload API unit**

```bash
git add pages/api/staff-training-certificates-upload.ts \
  src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts \
  src/services/staff/staffAuditService.ts
git commit -m "feat(hs): upload classified training certificates"
```

---

### Task 5: Add transactional verification, rejection, revocation, and deletion

**Files:**

- Modify: `src/modules/health-safety/services/trainingCertificateService.ts`
- Create: `src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts`
- Modify: `pages/api/staff-documents/[documentId]/verify.ts`
- Modify: `pages/api/staff-documents/[documentId].ts`
- Modify: `src/services/staff/staffAuditService.ts`

**Interfaces:**

- Produces:

```typescript
export type TrainingCertificateTransition =
  | { status: 'verified' }
  | { status: 'rejected'; reason: string }
  | { status: 'revoked'; reason: string };

export interface TrainingCertificateActor {
  userId: string;
  staffId: string | null;
}

export async function transitionTrainingCertificate(
  txn: TxnClient,
  documentId: string,
  actor: TrainingCertificateActor,
  transition: TrainingCertificateTransition
): Promise<{
  documentId: string;
  staffId: string;
  status: TrainingVerificationStatus;
  contractorIds: string[];
  idempotent: boolean;
}>;

export async function deleteTrainingCertificateSubmission(
  txn: TxnClient,
  documentId: string
): Promise<{ staffId: string; fileName: string }>;
```

- [x] **Step 1: Write failing lifecycle tests**

Test pending to verified, pending to rejected with mandatory reason, verified to revoked with mandatory reason, same-terminal-state idempotency, conflicting terminal transition `409`, missing linked rows failure, and immutable delete for verified/revoked submissions.

- [x] **Step 2: Run the lifecycle test and verify red**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts
```

Expected: FAIL because lifecycle services are absent.

- [x] **Step 3: Implement locked transactional transitions**

Use `SELECT ... FOR UPDATE` on the document and linked training rows. Accept only:

- `pending -> verified`;
- `pending -> rejected`;
- `verified -> revoked`;
- same status -> idempotent success.

Set the actor/timestamp/reason fields on every linked row and matching staff-document status in the same transaction. Use `actor.userId` for the new `hs_worker_training.*_by` columns, which reference `users(id)`, and `actor.staffId` for the existing `staff_documents.verified_by`, which references `staff(id)`. A user with no linked staff row leaves the staff-document actor nullable while the training rows and audit retain the authenticated user id. Reject a pending certification with zero linked records.

- [x] **Step 4: Delegate certification verification from the existing route**

Keep non-certification OCR behavior intact. For `document_type = 'certification'`, skip OCR-to-staff synchronization, resolve the authenticated user's linked staff id once, and call `transitionTrainingCertificate` through `transaction()`. Return `409` for conflicts and a storage-safe result.

- [x] **Step 5: Implement lifecycle-aware deletion**

For certification documents, dedicated delete permission is required. Inside one transaction lock the document, reject verified/revoked state, delete linked pending/rejected training rows, then delete the document row. After commit delete the VF object; if the storage delete fails, record an operational cleanup error while retaining the database audit trail.

- [x] **Step 6: Add revocation audit support and contractor recomputation**

Add `document_revoked` and `logDocumentRevoked`. Emit staff and H&S audit activity only after commit. Recompute each distinct non-null contractor id after a verified or revoked transition; internal-only version one normally returns none.

- [x] **Step 7: Run lifecycle and authorization regression tests**

Run:

```bash
npx vitest run \
  src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts \
  src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts
npm run type-check
```

Expected: PASS.

- [x] **Step 8: Commit the lifecycle unit**

```bash
git add src/modules/health-safety/services/trainingCertificateService.ts \
  src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts \
  pages/api/staff-documents/[documentId]/verify.ts \
  pages/api/staff-documents/[documentId].ts \
  src/services/staff/staffAuditService.ts
git commit -m "feat(hs): verify and revoke training evidence"
```

---

### Task 6: Make training reads and gates verified-only

**Files:**

- Modify: `src/modules/health-safety/services/trainingService.ts`
- Modify: `pages/api/health-safety/training/records/index.ts`
- Modify: `src/modules/health-safety/__tests__/trainingService.test.ts`
- Modify: `src/modules/health-safety/__tests__/trainingRecordsApi.test.ts`
- Modify: `src/modules/health-safety/__tests__/gateTraining.test.ts`

**Interfaces:**

- Consumes: `hs_worker_training.verification_status` and linked document id.
- Produces: verified-only score/gate queries and storage-safe training list rows; manual POST remains available only when `requires_certificate = false`.

- [ ] **Step 1: Add failing verified-only query assertions**

Assert the aggregate query includes:

```sql
WHERE wt.contractor_id = $contractor
  AND wt.verification_status = 'verified'
```

Add fixtures proving pending/rejected/revoked rows contribute zero, verified rows contribute once, and an expired verified statutory row still counts as expired evidence.

- [ ] **Step 2: Add failing manual-record API cases**

Require the selected type query to load `requires_certificate`. Assert:

- certificate-required type returns `400` with a message directing the caller to `/health-safety/training/certificates/new`;
- no-certificate type inserts `verification_status = 'verified'`;
- `certificate_url` in the request is ignored/rejected and never written;
- GET includes lifecycle status but omits `certificate_url`, `file_url`, and `file_path`.

- [ ] **Step 3: Run the training tests and verify red**

Run:

```bash
npx vitest run \
  src/modules/health-safety/__tests__/trainingService.test.ts \
  src/modules/health-safety/__tests__/trainingRecordsApi.test.ts \
  src/modules/health-safety/__tests__/gateTraining.test.ts
```

Expected: at least the pending/rejected/revoked exclusion cases FAIL.

- [ ] **Step 4: Implement verified-only aggregate and competency reads**

Filter at SQL level, not in React. Preserve the current `NULL` score when no verified rows exist. Any project competency matrix query must apply the same verified condition.

- [ ] **Step 5: Restrict manual record creation**

Use an explicit query branch for the training type. No-certificate manual records are accepted as verified legacy evidence; certificate-required types return the upload-flow route in the error metadata.

- [ ] **Step 6: Remove raw certificate locations from reads**

Select only business metadata and return `hasCertificate: staff_document_id IS NOT NULL`. Binary access is always through the protected staff-document download route.

- [ ] **Step 7: Run the H&S training regression set**

Run:

```bash
npx vitest run \
  src/modules/health-safety/__tests__/trainingService.test.ts \
  src/modules/health-safety/__tests__/trainingRecordsApi.test.ts \
  src/modules/health-safety/__tests__/gateTraining.test.ts
npm run type-check
```

Expected: PASS.

- [ ] **Step 8: Commit the verified-only unit**

```bash
git add src/modules/health-safety/services/trainingService.ts \
  pages/api/health-safety/training/records/index.ts \
  src/modules/health-safety/__tests__/trainingService.test.ts \
  src/modules/health-safety/__tests__/trainingRecordsApi.test.ts \
  src/modules/health-safety/__tests__/gateTraining.test.ts
git commit -m "fix(hs): count only verified training evidence"
```

---

### Task 7: Build the reusable upload UI and both entry points

**Files:**

- Create: `src/modules/health-safety/components/training/TrainingCertificateUploadForm.tsx`
- Create: `src/modules/health-safety/components/training/TrainingCertificateFields.tsx`
- Create: `src/modules/health-safety/components/training/TrainingTypeMultiSelect.tsx`
- Create: `src/modules/health-safety/components/training/TrainingCertificateUploadDialog.tsx`
- Create: `pages/health-safety/training/certificates/new.tsx`
- Create: `src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx`
- Modify: `pages/health-safety/training/index.tsx`
- Modify: `pages/health-safety/training/new.tsx`
- Modify: `src/components/staff/StaffDocumentList.tsx`

**Interfaces:**

- Produces:

```typescript
export interface TrainingCertificateUploadFormProps {
  staffId?: string;
  onSuccess(result: {
    documentId: string;
    trainingRecordIds: string[];
    verificationStatus: 'pending';
  }): void;
  onCancel(): void;
}
```

The form posts `FormData` to `/api/staff-training-certificates-upload`. The staff dialog supplies `staffId`; the H&S page leaves it unset and renders employee selection.

- [ ] **Step 1: Write failing UI tests**

With Testing Library, assert:

- staff entry does not render employee selection and submits the supplied id;
- H&S entry requires employee selection;
- two selected types appear as chips in review;
- missing/invalid file and expiry-before-completion block submission;
- the success callback fires only after a successful API response;
- failed API responses leave the form open with an error;
- certificate-required types on `/health-safety/training/new` show an upload-flow link and no URL field;
- restricted action flags hide upload/download/verify controls.

- [ ] **Step 2: Run the UI test and verify red**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx
```

Expected: FAIL because the shared components do not exist.

- [ ] **Step 3: Implement focused field and multi-select components**

`TrainingCertificateFields` owns file, certificate number, provider, completion date, and optional expiry. `TrainingTypeMultiSelect` accepts active `HSTrainingType[]`, selected ids, and `onChange(ids)`. Keep each below 200 lines.

- [ ] **Step 4: Implement the shared form**

Use explicit `details -> review -> submitting` state. Submit only after review, await the API response, parse `apiResponse` errors, then call `onSuccess`. Do not optimistically show success.

- [ ] **Step 5: Add the H&S page and training index action**

Create `/health-safety/training/certificates/new` with `AppLayout` and `ModulePage`, staff selection from the existing picker API, and a back link. Add **Upload certificate** to the H&S training index without adding a sidebar.

- [ ] **Step 6: Add the staff-profile dialog**

Add a small **Upload training certificate** action to `StaffDocumentList`, render `TrainingCertificateUploadDialog`, refresh documents after success, and render linked competency chips from the list API. Do not add certificate logic to the existing 690-line generic wizard.

- [ ] **Step 7: Restrict manual training UI**

Remove `certificate_url` state/input/payload. If the selected type has `requires_certificate = true`, replace the save action with a link to the upload page. Preserve contractor/manual entry only for types with `requires_certificate = false`.

- [ ] **Step 8: Run UI and type checks**

Run:

```bash
npx vitest run src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx
npm run type-check
npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit the UI unit**

```bash
git add src/modules/health-safety/components/training \
  pages/health-safety/training/certificates/new.tsx \
  src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx \
  pages/health-safety/training/index.tsx \
  pages/health-safety/training/new.tsx \
  src/components/staff/StaffDocumentList.tsx
git commit -m "feat(hs): add training certificate workflow"
```

---

### Task 8: Verify, document, publish, migrate with approval, and prove dev

**Files:**

- Modify: `src/modules/health-safety/.claude.md`
- Modify: `.claude/modules/health-safety.md`
- Verify: all files in Tasks 1–7

**Interfaces:**

- Consumes: the completed feature branch and all automated evidence.
- Produces: reviewed pull request, explicitly approved shared migration, dev deployment, browser/DB/storage proof, cleanup proof, and a final handoff. Production remains untouched.

- [ ] **Step 1: Update module documentation**

Document:

- certificate binaries live in `staff_documents`;
- linked competencies live in `hs_worker_training.staff_document_id`;
- lifecycle is pending/verified/rejected/revoked;
- only verified training counts;
- permission is `people.staff.training-certificates`;
- upload route is `/api/staff-training-certificates-upload`;
- binary access is through `/api/staff-documents-download`;
- employee self-submission and contractor-worker upload are not included.

- [ ] **Step 2: Run the complete focused test set**

Run:

```bash
npx vitest run \
  src/modules/health-safety/__tests__/trainingCertificateSchemaSync.test.ts \
  src/modules/health-safety/__tests__/trainingCertificateService.test.ts \
  src/modules/health-safety/__tests__/trainingCertificateUploadApi.test.ts \
  src/modules/health-safety/__tests__/trainingCertificateLifecycleApi.test.ts \
  src/modules/health-safety/__tests__/trainingCertificateUploadUi.test.tsx \
  src/modules/health-safety/__tests__/trainingService.test.ts \
  src/modules/health-safety/__tests__/trainingRecordsApi.test.ts \
  src/modules/health-safety/__tests__/gateTraining.test.ts \
  src/services/staff/__tests__/staffDocumentAccess.test.ts \
  src/services/staff/__tests__/staffDocumentApiAuthorization.test.ts
npm run ci:quick
npm run antihall
```

Expected: every command exits `0`.

- [ ] **Step 3: Run broader regression and local browser verification**

Run:

```bash
npm run ci
PORT=3004 npm run dev
```

In a browser against `http://localhost:3004`, prove the H&S and staff entry points render, restricted controls stay hidden for a restricted account, form validation works, and no success appears before the API response. Do not apply the shared migration merely to make local UI verification easier.

- [ ] **Step 4: Review against the approved design**

Invoke `superpowers:requesting-code-review`. Check every acceptance criterion in the design, all direct endpoint guards, raw-path omission, transactional behavior, file/component size limits, no `console.log`, and migration/rollback symmetry. Fix verified findings and rerun Steps 2–3.

- [ ] **Step 5: Commit docs and any review fixes**

```bash
git add src/modules/health-safety/.claude.md .claude/modules/health-safety.md
git commit -m "docs(hs): document training certificate controls"
git status --short
```

Expected: clean worktree.

- [ ] **Step 6: Push and open the pull request**

Use `gh` for the branch push and PR. The PR body must include:

- design and implementation-plan links;
- test commands and results;
- exact migration filename and rollback filename;
- preflight output;
- explicit warning that dev and production share the database;
- named custodian overrides still awaiting Hein's choice;
- production deployment excluded.

Do not merge yet.

- [ ] **Step 7: Stop at the shared-database confirmation gate**

Fetch current `origin/master`, recheck migration-number collision, run the read-only preflight against the shared database, and present:

- exact forward SQL;
- exact rollback SQL;
- duplicate count and existing-row backfill count;
- confirmation that the pending deploy will auto-apply the migration.

Ask Hein for explicit confirmation to apply this migration. Do not deploy dev before approval because the deploy applies pending migrations to the shared database.

- [ ] **Step 8: After explicit approval, merge and deploy dev**

After any required merge confirmation under the repository rule, merge the approved PR using `gh`, then:

```bash
bash scripts/deploy-local.sh dev
```

Capture the deployed commit, migration result, service status, and `/api/health` result. Do not deploy production.

- [ ] **Step 9: Run the throwaway dev proof**

Use prefix `ZZ-GOAL-TRAINCERT` and one harmless generated PDF:

1. create one uniquely named throwaway internal employee;
2. upload it once for Working at Heights and Fibre Splicing;
3. query the database and prove one document plus two pending linked rows;
4. prove pending rows are absent from competency/gate calculations;
5. prove a no-permission authenticated user receives `403` for metadata and binary access;
6. verify the submission and prove both rows become verified/effective;
7. revoke it with a reason and prove both rows cease to count without losing audit evidence;
8. prove list responses contain no `file_path`, `file_url`, or `certificate_url`.

- [ ] **Step 10: Clean up and independently prove zero residue**

Delete the throwaway employee, linked training rows, document row, permission-test overrides, and VF Storage object using the supported lifecycle. Independently query by prefix/document id and list the storage object location:

```text
staff rows = 0
staff_documents rows = 0
hs_worker_training rows = 0
temporary permission overrides = 0
VF Storage matching objects = 0
```

Do not remove any pre-existing user, certificate, training row, or file.

- [ ] **Step 11: Write the final handoff**

Record PR/merge commit, dev deployed commit, migration and rollback filenames, test outputs, browser evidence, database before/after counts, VF cleanup proof, named custodian decision still required, and the exact statement: **Production was not deployed.**

The feature is complete only when all automated tests pass, dev proof succeeds, cleanup is independently verified, and the handoff is saved.
