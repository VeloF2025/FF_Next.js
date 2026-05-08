-- Rollback for Migration 335
-- WARNING: This drops columns; any data in them will be lost. Only run if 335 was applied
-- to an empty/test database OR if forward-port has not yet been performed.
--
-- The shared dev+prod Supabase DB convention (see project CLAUDE.md) means any
-- ingestion that has populated these columns will lose data. The DO-block guard
-- below aborts the rollback if olt_port (the canonical "ingestion happened" flag)
-- has any non-null value. To override (eg. for a true test DB or a forced rollback),
-- run with `psql -v force=1 -f rollback_335_pon_workspace_extend_stage_tracking.sql`
-- or comment out the guard.

BEGIN;

DO $guard$
DECLARE
  populated_count integer;
BEGIN
  SELECT COUNT(*) INTO populated_count FROM pon_stage_tracking WHERE olt_port IS NOT NULL;
  IF populated_count > 0 THEN
    RAISE EXCEPTION
      'Rollback aborted: pon_stage_tracking has % rows with olt_port populated. Data loss prevented. To force, edit rollback file and remove this guard.',
      populated_count;
  END IF;
END
$guard$;

DROP INDEX IF EXISTS idx_pon_stage_olt_port;

ALTER TABLE pon_stage_tracking
  DROP COLUMN IF EXISTS olt_port,
  DROP COLUMN IF EXISTS hld_pon,
  DROP COLUMN IF EXISTS z_pon,
  DROP COLUMN IF EXISTS scope_string,
  DROP COLUMN IF EXISTS sign_ups,
  DROP COLUMN IF EXISTS homes_po,
  DROP COLUMN IF EXISTS homes_recon,
  DROP COLUMN IF EXISTS available,
  DROP COLUMN IF EXISTS pct_original,
  DROP COLUMN IF EXISTS pct_recon;

COMMIT;
