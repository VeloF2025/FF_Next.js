-- Rollback for 436_sitecam_appeals_vlm.sql
DROP INDEX IF EXISTS sitecam_appeals_vlm_pending;

ALTER TABLE sitecam_appeals DROP CONSTRAINT IF EXISTS sitecam_appeals_decided_via_check;
ALTER TABLE sitecam_appeals
  ADD CONSTRAINT sitecam_appeals_decided_via_check
  CHECK (decided_via IN ('whatsapp','in_app'));

ALTER TABLE sitecam_appeals
  DROP COLUMN IF EXISTS vlm_recommendation,
  DROP COLUMN IF EXISTS vlm_confidence,
  DROP COLUMN IF EXISTS vlm_reasoning,
  DROP COLUMN IF EXISTS vlm_checks,
  DROP COLUMN IF EXISTS vlm_serial_read,
  DROP COLUMN IF EXISTS vlm_model,
  DROP COLUMN IF EXISTS vlm_evaluated_at,
  DROP COLUMN IF EXISTS vlm_attempts,
  DROP COLUMN IF EXISTS vlm_skip_reason,
  DROP COLUMN IF EXISTS human_agreed_with_vlm;
