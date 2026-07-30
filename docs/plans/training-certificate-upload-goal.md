# /goal — Classified Training Certificate Upload (implement, test, prove on dev)

> **How to use:** start a fresh Codex session in
> `/home/hein/Workspace/FF_Next.js-training-certificate-design` and run:
>
> `/goal Execute docs/plans/training-certificate-upload-goal.md to completion using superpowers:executing-plans and docs/superpowers/plans/2026-07-30-training-certificate-upload.md task-by-task. Work inline and autonomously through implementation, TDD, review, PR, approved shared migration, dev deploy, browser/DB/VF proof, and cleanup. Loop until every success criterion is proven. Stop only at the confirmation gates in section 7 or a genuine external blocker. Do not deploy production and do not spawn subagents unless Hein explicitly asks.`

## 1. Mission

Implement the approved classified training-certificate workflow so an appointed
custodian can upload one employee certificate, assign one or more separate
competencies, and submit them for verification.

Store the binary once in `staff_documents` as `certification`. Link each selected
competency through `hs_worker_training.staff_document_id`. Pending, rejected, and
revoked rows must never count as valid competency or gate evidence; verification
must atomically activate every linked row.

The approved design is:

`docs/superpowers/specs/2026-07-30-training-certificate-upload-design.md`

The executable TDD plan is:

`docs/superpowers/plans/2026-07-30-training-certificate-upload.md`

## 2. Start state and operating rules

- Work only in `/home/hein/Workspace/FF_Next.js-training-certificate-design`.
- The branch started as `design/training-certificate-upload` from
  `origin/master` commit `fffc58fe7`.
- Approved design commit: `06cdff42c`.
- Fetch `origin` and inspect status before editing. Preserve unrelated user work.
- Use `superpowers:executing-plans` inline. Track every plan checkbox and checkpoint.
- Do not spawn subagents unless Hein explicitly asks for delegation.
- Use TDD: failing test, prove red, minimal implementation, prove green, commit.
- All code goes through a pull request. Use `gh` for GitHub work.
- Run `npm run ci:quick` before the PR and `npm run ci` before claiming complete.
- Use `pg.Pool` transactions from `src/lib/db-pool.ts` for linked writes.
- Never expose certificate storage paths or URLs in H&S responses.
- Never log certificate numbers, file contents, medical information, storage paths,
  or storage URLs.
- No production deploy is authorized by this goal.

## 3. Locked product decisions

1. One upload workflow supports all training types; do not build separate uploaders
   for Working at Heights, Fibre Splicing, OTDR, or other competencies.
2. At least one active training type is mandatory. One document may link to several
   types.
3. Version one is internal employees only. Contractor-worker capture and employee
   self-submission remain out of scope.
4. Add the initial non-statutory types `fibre_splicing`, `otdr_testing`,
   `blown_fibre_installation`, and `aerial_fibre_installation` with no invented
   default expiry.
5. New uploads start pending. Only verified rows count.
6. Rejection requires a reason. Revocation of verified evidence requires a reason
   and preserves the document and audit history.
7. Pending/rejected submissions may be deleted with the required permission;
   verified/revoked submissions are immutable through delete.
8. New free-text certificate URLs are forbidden. Legacy `certificate_url` remains
   in the database only for old rows and is not exposed.
9. The dedicated permission is `people.staff.training-certificates` with
   `view/create/edit/delete`; seed `super_admin` only.
10. Broad H&S users can see competency state, worker, completion, expiry, and
    verification state, but cannot see or download the certificate without the
    dedicated view permission.
11. The existing manual training page remains only for catalogue types with
    `requires_certificate = false`.
12. Staff-profile and H&S entry points share the same focused form. Add no sidebar.

## 4. Required implementation sequence

Follow all eight tasks in the implementation plan in order:

1. additive migration, rollback, preflight, and scratch-database proof;
2. transactional domain and validation services;
3. type-aware authorization on every direct staff-document endpoint;
4. flattened multipart upload with VF Storage compensation;
5. transactional verify/reject/revoke/delete lifecycle and audits;
6. verified-only reads, competency, and contractor-gate calculations;
7. shared UI from staff Documents and H&S Training;
8. full verification, review, PR, approved migration, dev proof, cleanup, handoff.

Do not skip a red test, focused green test, commit boundary, review finding, or
cleanup readback.

## 5. Required automated evidence

At minimum, prove:

- one upload creates one document and one or multiple linked pending rows;
- explicit, catalogue-derived, and no-expiry paths;
- duplicate type and duplicate certificate rejection;
- invalid type/date/file/size/magic-byte rejection;
- storage object deletion after database failure;
- permission matrix for upload, list, detail, update, delete, verify, download,
  and expiring routes;
- H&S-view-only users cannot retrieve the binary;
- pending/rejected/revoked excluded and verified included exactly once;
- verify/reject/revoke state transitions, idempotency, and conflicting `409`;
- verified/revoked delete protection;
- non-sensitive responses omit `file_path`, `file_url`, and `certificate_url`;
- staff entry preselects the employee, H&S entry requires employee selection;
- API-confirmed success only;
- restricted UI actions hidden.

Final commands:

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
npm run ci
```

Every command must exit `0`; investigate and fix failures rather than weakening a
test or bypassing a hook.

## 6. Dev proof and cleanup

After the shared migration is explicitly approved and dev is deployed with
`bash scripts/deploy-local.sh dev`, use prefix `ZZ-GOAL-TRAINCERT` and one harmless
generated PDF.

Prove in the real dev UI plus independent database/storage reads:

1. the staff and H&S entry points both work;
2. one upload classified as Working at Heights plus Fibre Splicing creates exactly
   one `staff_documents` row and two pending `hs_worker_training` rows;
3. both rows reference the same document id;
4. pending evidence does not count;
5. an authenticated unauthorized user gets `403` for metadata and binary access;
6. verification atomically activates both competencies;
7. revocation removes both from calculations without deleting audit history;
8. no API response exposes a raw path or URL;
9. all throwaway staff, document, training, audit-test override, and VF Storage
   artifacts are removed;
10. independent cleanup queries and a storage listing each return zero matches.

Do not touch pre-existing staff, training records, permissions, audits, or files.

## 7. Confirmation gates

These are the only planned reasons to stop and ask Hein:

1. **Shared database migration:** immediately before applying the additive
   migration, or before any dev deploy that auto-applies it, present the exact
   SQL, exact rollback, migration-number collision check, and read-only preflight
   counts. Wait for explicit approval.
2. **Named custodians:** do not create user permission overrides until Hein names
   the users and actions. Explain that each named user also needs permitted
   `people` and `people.staff` ancestors.
3. **Merge into `master`:** repository instructions classify merges as destructive.
   Present review and CI evidence and wait for explicit merge confirmation.
4. **Production:** production deployment is outside this goal. Do not run it even
   after dev succeeds without a separate explicit approval in the allowed window.

Continue all work that does not depend on a pending gate. A difficult test or code
review finding is not a confirmation gate.

## 8. Definition of done

Done means:

- every plan checkbox is completed;
- all focused and full CI commands pass;
- review findings are resolved and reverified;
- the PR is approved and merged after confirmation;
- the approved migration is applied successfully;
- the exact merged commit is deployed to dev using the required script;
- real-browser, database, and VF Storage evidence proves the workflow and its
  authorization;
- all `ZZ-GOAL-TRAINCERT` artifacts are removed and zero residue is independently
  proven;
- the handoff records PR, commits, migration/rollback, deployed dev commit, tests,
  browser proof, database/storage cleanup, outstanding named-custodian decision,
  and explicitly states **Production was not deployed.**

Do not claim completion from unit tests alone.
