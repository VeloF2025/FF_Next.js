-- Migration 482: reject attendance adjustments whose clock-out precedes clock-in.
--
-- Why: nothing enforced ordering on attendance_adjustments. A worker correction
-- submitted on 2026-05-18 for work_date 2026-05-15 carried the *submission*
-- date in adjusted_clock_in_at, so the row described a shift of MINUS 61.5
-- hours. It sat pending for three months and would have fed payroll had it
-- been approved.
--
-- The day-exception path (requiredActionCorrection.validateClaimedClockOut)
-- already rejects this, but it only ever sets adjusted_clock_out_at. The path
-- that can set BOTH timestamps — pages/api/field/attendance-adjust.ts — checked
-- only that each timestamp parsed, never that they were ordered. This
-- migration closes the storage-layer hole; that endpoint gains a matching 400
-- in the same change so the worker sees a clear error instead of storing a row
-- nobody can approve.
--
-- Deliberately ordering-only. A work_date bound was considered and rejected:
-- a night shift legitimately ends on work_date + 1, so a date-range CHECK would
-- reject real corrections to catch a typo the ordering rule already catches
-- (the bad row was negative, not merely off-date).
--
-- NULL handling is explicit rather than implicit. A CHECK that evaluates to
-- NULL passes in Postgres — it fails only on FALSE — so the bare comparison
-- would already permit the one-sided case. Spelling out the IS NULL arms makes
-- the intent legible to the next reader instead of resting on that subtlety:
-- setting only one side stays legal, and is what `forgot_clock_out` does.
--
-- Verified against production before writing: exactly one row in the table
-- violated this, and it was corrected on 2026-08-06, so the constraint
-- validates without a NOT VALID staging step.
--
-- Re-runnable: the ADD fires only when the constraint is absent.

-- Preflight. ADD CONSTRAINT validates existing rows immediately, and
-- run-pending-migrations.sh aborts the whole deploy on a failed migration
-- (`✗ FAILED — aborting`, exit 1). A bare constraint violation would surface
-- as SQLSTATE 23514 naming neither the row nor the remedy, on a shared
-- dev+prod database, mid-deploy. Fail here instead with the offending ids.
--
-- This deliberately still BLOCKS rather than skipping: a violating row means
-- someone's shift is recorded as negative, and silently declining to enforce
-- the rule would leave that true indefinitely. The goal is an actionable
-- failure, not an avoidable one.
DO $$
DECLARE
  bad_count integer;
  bad_ids   text;
BEGIN
  SELECT COUNT(*), COALESCE(string_agg(id::text, ', ' ORDER BY id), '')
  INTO bad_count, bad_ids
  FROM attendance_adjustments
  WHERE adjusted_clock_in_at IS NOT NULL
    AND adjusted_clock_out_at IS NOT NULL
    AND adjusted_clock_out_at <= adjusted_clock_in_at;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Migration 482 preflight: % attendance_adjustments row(s) have a clock-out at or before their clock-in. Correct them before this constraint can be added. Offending ids: %',
      bad_count, bad_ids
      USING HINT =
        'Typically the clock-in carries the submission date instead of the work date. '
        'Reset the timestamp to the value the worker intended; do not delete the row.';
  END IF;
END $$;

DO $$
BEGIN
  -- to_regclass() resolves through search_path so the guard inspects the same
  -- table the ALTER targets, including under the migration tests' scratch
  -- schema. A hard-coded table_schema = 'public' would not.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('attendance_adjustments')
      AND conname = 'attendance_adjustments_time_order'
  ) THEN
    ALTER TABLE attendance_adjustments
      ADD CONSTRAINT attendance_adjustments_time_order
      CHECK (
        adjusted_clock_in_at IS NULL
        OR adjusted_clock_out_at IS NULL
        OR adjusted_clock_out_at > adjusted_clock_in_at
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT attendance_adjustments_time_order ON attendance_adjustments IS
  'When a correction sets both timestamps, clock-out must be strictly after '
  'clock-in. Setting only one side remains legal (forgot_clock_out). Added in '
  'migration 482 after a -61.5h row reached the review queue.';
