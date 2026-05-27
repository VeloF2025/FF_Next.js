-- Migration 280: EOD install sheets — dual-person designation
-- Adds velocity_rep_name/id columns to capture both signature rows from the form.

BEGIN;

ALTER TABLE eod_install_sheets
  ADD COLUMN IF NOT EXISTS velocity_rep_name TEXT,
  ADD COLUMN IF NOT EXISTS velocity_rep_id   TEXT;

COMMENT ON COLUMN eod_install_sheets.velocity_rep_name IS 'Velocity Fibre representative who co-signed the form';
COMMENT ON COLUMN eod_install_sheets.velocity_rep_id   IS 'Employee ID of the Velocity Fibre representative';

COMMIT;
