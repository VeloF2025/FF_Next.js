-- rollback_524_oes_pp_exit_reason.sql
--
-- Reverses 524. Re-runnable: every statement is guarded, so applying this twice
-- is a no-op rather than an error.
--
-- ⚠️ DATA LOSS. exit_reason / exit_reason_at / exit_reason_by are hand-entered
-- and exist nowhere else — not in the Fibertime export, not in any other table.
-- Dropping the columns destroys every classification anyone has recorded, with
-- no way to recover it. If the intent is only to stop the exit path taking
-- effect, do NOT run this: revert the `exit_reason IS NULL` clause in the
-- pp_open snapshot source instead and leave the data alone.

DROP INDEX IF EXISTS idx_oes_pp_data_exit_reason;
DROP INDEX IF EXISTS idx_oes_pp_data_open_no_exit;

ALTER TABLE oes_pp_data
  DROP CONSTRAINT IF EXISTS oes_pp_data_exit_reason_coherence_check;

ALTER TABLE oes_pp_data
  DROP CONSTRAINT IF EXISTS oes_pp_data_exit_reason_check;

ALTER TABLE oes_pp_data
  DROP COLUMN IF EXISTS exit_reason_by,
  DROP COLUMN IF EXISTS exit_reason_at,
  DROP COLUMN IF EXISTS exit_reason;

-- Clear this migration's own row so the runner will re-apply it cleanly.
DELETE FROM schema_migrations
 WHERE filename = '524_oes_pp_exit_reason.sql';
