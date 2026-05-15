-- Rollback for migration 351: works-qa per-photo snag workflow schema.
--
-- WARNING: data-destructive. Run only if you also intend to roll back
-- migration 350 (RBAC) and re-deploy code prior to PR #1633.

BEGIN;

-- pole_qa_photos.slot_approvals
ALTER TABLE pole_qa_photos
  DROP COLUMN IF EXISTS slot_approvals;

-- snags additions
DROP INDEX IF EXISTS uq_snags_open_per_slot;
DROP INDEX IF EXISTS idx_snags_slot_key;
DROP INDEX IF EXISTS idx_snags_pole_qa_photo;
DROP INDEX IF EXISTS idx_snags_source;
ALTER TABLE snags DROP CONSTRAINT IF EXISTS snags_discipline_check;
ALTER TABLE snags DROP CONSTRAINT IF EXISTS snags_source_check;
ALTER TABLE snags DROP COLUMN IF EXISTS discipline;
ALTER TABLE snags DROP COLUMN IF EXISTS slot_photo_key;
ALTER TABLE snags DROP COLUMN IF EXISTS slot_key;
ALTER TABLE snags DROP COLUMN IF EXISTS pole_qa_photo_id;
ALTER TABLE snags DROP COLUMN IF EXISTS source;

-- snag_reports additions
DROP INDEX IF EXISTS uq_snag_reports_works_qa_per_pole;
DROP INDEX IF EXISTS idx_snag_reports_pole_qa_photo;
DROP INDEX IF EXISTS idx_snag_reports_source;
ALTER TABLE snag_reports ALTER COLUMN audit_date SET NOT NULL;
ALTER TABLE snag_reports DROP COLUMN IF EXISTS pole_qa_photo_id;
ALTER TABLE snag_reports DROP CONSTRAINT IF EXISTS snag_reports_source_check;
ALTER TABLE snag_reports DROP COLUMN IF EXISTS source;

COMMIT;
