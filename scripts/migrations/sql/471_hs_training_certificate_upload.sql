-- Migration 471: classified training certificate upload.
--
-- Additive and idempotent. Links one stored certificate binary
-- (staff_documents.document_type = 'certification') to one or more H&S
-- competencies (hs_worker_training), and gives that link a verification
-- lifecycle so unverified evidence cannot satisfy a statutory gate.
--
-- Design: docs/superpowers/specs/2026-07-30-training-certificate-upload-design.md
--
-- NOT wrapped in BEGIN;/COMMIT; on purpose. scripts/run-pending-migrations.sh
-- applies this file as `psql -1 -c "\i <file>" -c "INSERT INTO
-- schema_migrations ..."`. Postgres does not nest transactions, so a COMMIT
-- inside the file ends psql's transaction early and lets the DDL commit while
-- its tracker row fails independently. Matches 467 and 469.
--
-- Read off the live shared database before this was written (2026-07-30):
--   * users.id, staff.id and staff_documents.id are all uuid.
--   * staff_documents carries NO check constraints at all — the
--     chk_verification_status in create-staff-documents-tables.sql was never
--     applied here, so section 3 ADDS it rather than widening one. Live values
--     are only pending/verified/expired, so no existing row is invalidated.
--   * chk_document_type is deliberately NOT (re)created: live rows use 'sa_id'
--     and 'passport', which that constraint would reject.
--   * update_expired_documents() does not exist live and has no caller in the
--     application. Section 4 defines it anyway so that wherever it is created,
--     it cannot trample a rejection or a revocation.
--   * hs_worker_training held 0 rows, so the section 2 backfill is a no-op
--     here; it exists for any environment that already has manual records.

-- ---------------------------------------------------------------------------
-- 1. Link + lifecycle columns on the per-worker training record
-- ---------------------------------------------------------------------------
-- ON DELETE RESTRICT: the certificate is the evidence for the competency, so
-- the document row cannot be removed out from under a training record. The
-- delete path unlinks the training rows first, inside one transaction.
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

-- ---------------------------------------------------------------------------
-- 2. One-time backfill, closed by the constraint created alongside it
-- ---------------------------------------------------------------------------
-- Every row present at this point predates the upload workflow and was already
-- treated as accepted evidence, so it becomes 'verified' rather than keeping
-- the column default of 'pending'.
--
-- Guarded on the constraint created in the same block, so the backfill runs
-- exactly once. An unguarded UPDATE would, on any re-run, silently approve
-- every genuinely-pending submission in the table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hs_worker_training_verification_status_chk'
  ) THEN
    UPDATE hs_worker_training
      SET verification_status = 'verified';

    ALTER TABLE hs_worker_training
      ADD CONSTRAINT hs_worker_training_verification_status_chk
      CHECK (verification_status IN ('pending', 'verified', 'rejected', 'revoked'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. staff_documents: add the 'revoked' terminal state
-- ---------------------------------------------------------------------------
-- 'expired' is retained. A revoked certificate keeps its binary and its audit
-- trail; only its standing as evidence is withdrawn.
ALTER TABLE staff_documents DROP CONSTRAINT IF EXISTS chk_verification_status;
ALTER TABLE staff_documents ADD CONSTRAINT chk_verification_status
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired', 'revoked'));

-- ---------------------------------------------------------------------------
-- 4. The expiry sweep must not overwrite a terminal decision
-- ---------------------------------------------------------------------------
-- The previous body matched `verification_status != 'expired'`, which would
-- flip a rejection or a revocation to 'expired' the moment the certificate's
-- own date passed — quietly erasing why it stopped counting.
CREATE OR REPLACE FUNCTION update_expired_documents()
RETURNS void AS $$
BEGIN
  UPDATE staff_documents
  SET verification_status = 'expired',
      updated_at = NOW()
  WHERE expiry_date < CURRENT_DATE
    AND verification_status IN ('pending', 'verified');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
-- One certificate classifies a given competency at most once. Partial, because
-- legacy manual rows have no document and may repeat a type freely.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hs_worker_training_document_type
  ON hs_worker_training (staff_document_id, training_type_id)
  WHERE staff_document_id IS NOT NULL;

-- Serves the contractor gate, which now filters on verification_status.
CREATE INDEX IF NOT EXISTS idx_hs_worker_training_gate
  ON hs_worker_training (contractor_id, verification_status, expiry_date);

-- One live certificate number per employee per issuing authority, compared
-- case- and whitespace-insensitively. A blank number is not a collision, and a
-- rejected, revoked or expired submission must not block the corrected
-- re-upload — hence the partial predicate rather than a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_documents_certification_number
  ON staff_documents (staff_id, LOWER(BTRIM(document_number)), LOWER(BTRIM(issuing_authority)))
  WHERE document_type = 'certification'
    AND verification_status IN ('pending', 'verified')
    AND NULLIF(BTRIM(document_number), '') IS NOT NULL
    AND NULLIF(BTRIM(issuing_authority), '') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Seed the initial non-statutory fibre competencies
-- ---------------------------------------------------------------------------
-- validity_months NULL = no invented refresher cadence. The record uses the
-- explicit expiry printed on the certificate when one is supplied; otherwise it
-- does not expire. Further competencies are added through the existing
-- catalogue, not by writing more upload code.
INSERT INTO hs_training_types (code, name, description, validity_months, is_statutory, requires_certificate, sort_order)
SELECT v.code, v.name, v.description, v.validity_months, v.is_statutory, v.requires_certificate, v.sort_order
FROM (VALUES
  ('fibre_splicing', 'Fibre Splicing', 'Fusion splicing, closure preparation and splice-loss testing', NULL::integer, false, true, 200),
  ('otdr_testing', 'OTDR Testing', 'OTDR trace capture and interpretation', NULL::integer, false, true, 210),
  ('blown_fibre_installation', 'Blown Fibre Installation', 'Blown fibre and microduct installation', NULL::integer, false, true, 220),
  ('aerial_fibre_installation', 'Aerial Fibre Installation', 'Aerial and pole-route fibre installation', NULL::integer, false, true, 230)
) AS v(code, name, description, validity_months, is_statutory, requires_certificate, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM hs_training_types t WHERE t.code = v.code
);

-- ---------------------------------------------------------------------------
-- 7. Dedicated permission, seeded to super_admin only
-- ---------------------------------------------------------------------------
-- parent_key = 'people.staff' so a user blocked on the staff module is blocked
-- here too; the RBAC service fails closed on a blocked ancestor. Named
-- custodians arrive later as explicit user overrides, which is why no other
-- role is granted: a blanket 'admin' grant would hand every admin the
-- certificate binaries this permission exists to withhold.
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('action', 'people.staff.training-certificates', 'people.staff',
   'Training Certificates',
   'Upload, download, verify, reject, revoke and delete employee training certificates',
   NULL, 40, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin', 'people.staff.training-certificates',
   '{"view":true,"create":true,"edit":true,"delete":true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Tracker row
-- ---------------------------------------------------------------------------
-- The runner appends this too; recorded here so a manual `psql -f` apply does
-- not leave the migration unrecorded.
INSERT INTO schema_migrations (filename, applied_at)
VALUES ('471_hs_training_certificate_upload.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
