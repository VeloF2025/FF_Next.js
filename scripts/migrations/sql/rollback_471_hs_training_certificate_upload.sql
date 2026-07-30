-- Rollback: 471_hs_training_certificate_upload.sql
--
-- Re-runnable. Every DDL statement is guarded, and the two data statements are
-- written so a second run matches nothing rather than aborting.
--
-- ⚠️ 'revoked' stops being a representable state. A revoked certificate is
-- mapped to 'rejected' with a note rather than deleted: the record that the
-- evidence was withdrawn is the only thing keeping it from counting again.
-- That mapping is lossy — a rolled-back-then-reapplied database can no longer
-- distinguish a rejected submission from a revoked one.
--
-- ⚠️ Section 4 restores chk_verification_status to the four-value vocabulary
-- documented in scripts/migrations/create-staff-documents-tables.sql. That
-- constraint did NOT exist on the shared database before 471 (verified
-- 2026-07-30), so this leaves staff_documents marginally stricter than it was
-- found. All live values fall inside the four, so nothing is invalidated.
--
-- ⚠️ Dropping hs_worker_training.verification_status discards every pending and
-- rejected decision. Surviving rows become indistinguishable from the manually
-- entered legacy records that the forward migration backfilled to 'verified'.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rescue the terminal state that is about to stop existing
-- ---------------------------------------------------------------------------
-- Must run before section 4 restores the constraint that forbids 'revoked'.
UPDATE staff_documents
SET verification_status = 'rejected',
    verification_notes = CONCAT_WS(
      E'\n',
      NULLIF(verification_notes, ''),
      '[rollback] revoked training certificate retained as rejected'
    )
WHERE verification_status = 'revoked';

-- ---------------------------------------------------------------------------
-- 2. Drop the indexes 471 added
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS ux_hs_worker_training_document_type;
DROP INDEX IF EXISTS idx_hs_worker_training_gate;
DROP INDEX IF EXISTS ux_staff_documents_certification_number;

-- ---------------------------------------------------------------------------
-- 3. Drop the lifecycle constraint, then the columns it governed
-- ---------------------------------------------------------------------------
ALTER TABLE hs_worker_training
  DROP CONSTRAINT IF EXISTS hs_worker_training_verification_status_chk;

ALTER TABLE hs_worker_training
  DROP COLUMN IF EXISTS staff_document_id,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS revoked_by,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS revocation_reason;

-- ---------------------------------------------------------------------------
-- 4. Restore the previous staff-document status vocabulary and expiry sweep
-- ---------------------------------------------------------------------------
ALTER TABLE staff_documents DROP CONSTRAINT IF EXISTS chk_verification_status;
ALTER TABLE staff_documents ADD CONSTRAINT chk_verification_status
  CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired'));

CREATE OR REPLACE FUNCTION update_expired_documents()
RETURNS void AS $$
BEGIN
  UPDATE staff_documents
  SET verification_status = 'expired',
      updated_at = NOW()
  WHERE expiry_date < CURRENT_DATE
    AND verification_status != 'expired';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. Remove the dedicated permission
-- ---------------------------------------------------------------------------
-- role_permissions and user_permission_overrides both cascade from
-- access_permissions(key), but the grant is deleted explicitly so a rollback
-- against a database without that cascade still leaves nothing behind.
DELETE FROM role_permissions
WHERE permission_key = 'people.staff.training-certificates';

DELETE FROM access_permissions
WHERE key = 'people.staff.training-certificates';

-- ---------------------------------------------------------------------------
-- 6. Remove the seeded fibre competencies that nothing references
-- ---------------------------------------------------------------------------
-- A type someone has already recorded training against is kept: deleting it
-- would either fail on the ON DELETE RESTRICT foreign key or destroy a real
-- competency record.
DELETE FROM hs_training_types t
WHERE t.code IN (
  'fibre_splicing',
  'otdr_testing',
  'blown_fibre_installation',
  'aerial_fibre_installation'
)
AND NOT EXISTS (
  SELECT 1 FROM hs_worker_training w WHERE w.training_type_id = t.id
);

-- ---------------------------------------------------------------------------
-- 7. Clear the tracker row
-- ---------------------------------------------------------------------------
-- scripts/migrations/run.ts does this too, but a rollback run by hand with
-- `psql -f` would otherwise leave 471 recorded as applied with its objects
-- gone — a state the forward runner never repairs.
DELETE FROM schema_migrations WHERE filename = '471_hs_training_certificate_upload.sql';

COMMIT;
