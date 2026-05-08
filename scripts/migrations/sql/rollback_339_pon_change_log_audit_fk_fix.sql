-- Rollback for Migration 339
-- Restores ON DELETE CASCADE behaviour on pon_change_log FKs and re-adds
-- the chk_pon_or_drop check constraint. Does NOT revoke GRANTs — they were
-- already present via Supabase default privileges before mig 339 added them
-- explicitly, and revoking would be more disruptive than leaving them.

BEGIN;

ALTER TABLE pon_change_log
  DROP CONSTRAINT IF EXISTS pon_change_log_pon_stage_id_fkey,
  DROP CONSTRAINT IF EXISTS pon_change_log_drop_id_fkey;

ALTER TABLE pon_change_log
  ADD CONSTRAINT pon_change_log_pon_stage_id_fkey
    FOREIGN KEY (pon_stage_id) REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  ADD CONSTRAINT pon_change_log_drop_id_fkey
    FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_pon_or_drop CHECK (pon_stage_id IS NOT NULL OR drop_id IS NOT NULL);

COMMIT;
