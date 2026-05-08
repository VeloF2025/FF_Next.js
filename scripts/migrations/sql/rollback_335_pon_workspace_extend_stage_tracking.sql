-- Rollback for Migration 335
-- WARNING: This drops columns; any data in them will be lost. Only run if 335 was applied
-- to an empty/test database OR if forward-port has not yet been performed.

BEGIN;

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
