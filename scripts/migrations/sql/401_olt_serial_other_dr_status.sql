-- Migration 401: OLT mismatch — new fix_status 'serial_other_dr'
--
-- Context: the auto-detect queue processor previously marked a row 'not_found'
-- whenever a DR returned zero records from 1Map. That verdict only looked at the
-- drop number. We now do a reverse lookup by ONT serial when the DR is absent:
-- if the OES serial IS present on 1Map under a *different* drop, the unit is
-- installed and only the drop linkage is wrong — a distinct, more actionable
-- state than a blind 'not_found'.
--
-- Two DB objects gate the new status and must be widened to accept it:
--   1. the fix_status CHECK constraint
--   2. the partial unique index that keeps one active row per drop_number
--      (its predicate must list every "active/unresolved" status, and the
--       app-layer ON CONFLICT ... WHERE clauses must match it exactly)
--
-- Idempotent: safe to run multiple times.

-- 1. Widen the fix_status CHECK constraint
ALTER TABLE olt_mismatch_records
  DROP CONSTRAINT IF EXISTS olt_mismatch_records_status_check;

ALTER TABLE olt_mismatch_records
  ADD CONSTRAINT olt_mismatch_records_status_check
  CHECK (fix_status IN (
    'pending', 'fixed', 'skipped', 'not_found', 'empty_serial',
    'escalated', 'resolved', 'needs_reinvestigation', 'needs_investigation',
    'serial_other_dr'
  ));

-- 2. Recreate the active-row partial unique index with 'serial_other_dr' added.
--    No existing rows carry this status yet, so widening the predicate cannot
--    surface a uniqueness violation at creation time.
DROP INDEX IF EXISTS idx_olt_mismatch_drop_active_uniq;

CREATE UNIQUE INDEX idx_olt_mismatch_drop_active_uniq
  ON olt_mismatch_records (drop_number)
  WHERE fix_status IN (
    'pending', 'needs_investigation', 'not_found', 'empty_serial',
    'needs_reinvestigation', 'serial_other_dr'
  );

-- Report (for run logs)
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'olt_mismatch_records_status_check') AS status_check,
  (SELECT indexdef FROM pg_indexes
     WHERE indexname = 'idx_olt_mismatch_drop_active_uniq') AS active_uniq_index;
