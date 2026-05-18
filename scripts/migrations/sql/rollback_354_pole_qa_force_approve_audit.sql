-- Rollback for 354_pole_qa_force_approve_audit.sql

ALTER TABLE pole_qa_photos
  DROP COLUMN IF EXISTS override_reason,
  DROP COLUMN IF EXISTS overridden_by,
  DROP COLUMN IF EXISTS overridden_at;
