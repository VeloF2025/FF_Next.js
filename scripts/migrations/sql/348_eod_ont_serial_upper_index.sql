-- 348: Functional index on UPPER(ont_serial) for EOD-driven PP resolve.
--
-- The PP resolve pipeline (Layer 6) matches oes_pp_data.serial_number against
-- eod_install_sheet_entries.ont_serial case-insensitively. Without this index
-- the planner falls back to a seq-scan on eod_install_sheet_entries every time
-- the resolve runs.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.
-- Plain (non-CONCURRENT) because scripts/run-pending-migrations.sh wraps every
-- migration in `psql -1` (single transaction). CONCURRENTLY can't run inside a
-- transaction. The table is small (~50 rows), so the brief AccessExclusiveLock
-- during index build is negligible.

CREATE INDEX IF NOT EXISTS idx_eod_entries_upper_ont_serial
  ON eod_install_sheet_entries (UPPER(ont_serial))
  WHERE ont_serial IS NOT NULL;
