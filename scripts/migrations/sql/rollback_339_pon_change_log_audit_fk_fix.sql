-- Rollback for Migration 339
-- Restores ON DELETE CASCADE behaviour on pon_change_log FKs and re-adds
-- the chk_pon_or_drop check constraint. Does NOT revoke GRANTs — they were
-- already present via Supabase default privileges before mig 339 added them
-- explicitly, and revoking would be more disruptive than leaving them.
--
-- Edge case: after mig 339 was applied and audit rows accumulated, some
-- parent rows may have been deleted (nulling pon_stage_id and/or drop_id
-- via SET NULL). Re-adding chk_pon_or_drop with strict validation would
-- fail on those orphaned rows. We use NOT VALID so the constraint applies
-- to new inserts but does not retroactively block existing orphans —
-- preserving any history the SET NULL semantics preserved.

BEGIN;

ALTER TABLE pon_change_log
  DROP CONSTRAINT IF EXISTS pon_change_log_pon_stage_id_fkey,
  DROP CONSTRAINT IF EXISTS pon_change_log_drop_id_fkey;

ALTER TABLE pon_change_log
  ADD CONSTRAINT pon_change_log_pon_stage_id_fkey
    FOREIGN KEY (pon_stage_id) REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  ADD CONSTRAINT pon_change_log_drop_id_fkey
    FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_pon_or_drop CHECK (pon_stage_id IS NOT NULL OR drop_id IS NOT NULL) NOT VALID;

COMMIT;
