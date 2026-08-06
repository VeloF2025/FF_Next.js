-- Migration 479: scope the attendance expectation universe to opted-in staff.
--
-- Why: loadExpectedAttendanceDays projects `staff CROSS JOIN workdays`, so every
-- employed staff member was expected to clock in every Mon-Sat. On 2026-08-03
-- that raised 49 `missing_clock_in` exceptions and on 2026-08-04 another 51 —
-- but 26 and 27 of those, respectively, belong to staff who have NEVER clocked
-- in on any date. They are office/salaried people who do not use the clock at
-- all, not absentees. No existing column separates them: bcea_applicable is
-- true for all of them, hourly_rate is null for nearly all, and their
-- departments overlap the field workers'.
--
-- `attendance_tracked` makes that distinction explicit and HR-maintained.
--
-- Scope of the flag: it governs EXPECTATION only, never processing. An
-- untracked staff member who does clock in still gets their entry reconciled
-- and their hours paid — buildCandidates() merges entry-driven days on top of
-- expected days, so an entry-only day still produces a candidate. The flag
-- only decides whether a *missing* day is treated as an absence.
--
-- New staff default to false (untracked) and must be opted in by HR. That is
-- the deliberate trade-off: an un-opted-in new field worker's absences go
-- unflagged until someone sets the flag. The alternative default reproduces
-- ~50 exceptions/working-day for every new office hire.
--
-- Re-runnable: the backfill fires only when the column is created, so a replay
-- cannot resurrect a flag HR has since turned off.

DO $$
BEGIN
  -- to_regclass() resolves `staff` through search_path, so this guard agrees
  -- with the ALTER below in whatever schema the migration is applied to. A
  -- hard-coded table_schema='public' would inspect one table and alter
  -- another under a non-default search_path (as the migration tests use).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('staff')
      AND attname = 'attendance_tracked'
      AND NOT attisdropped
  ) THEN
    ALTER TABLE staff
      ADD COLUMN attendance_tracked boolean NOT NULL DEFAULT false;

    -- Seed from observed behaviour: anyone who has ever clocked in is a
    -- clocker. "Ever" rather than a recency window deliberately over-includes
    -- — over-including keeps a person under attendance control, which is the
    -- safe direction; a recency window could silently drop a real worker who
    -- was on long leave.
    UPDATE staff
    SET attendance_tracked = true
    WHERE id IN (
      SELECT DISTINCT staff_id
      FROM attendance_entries
      WHERE staff_id IS NOT NULL
    );
  END IF;
END $$;

COMMENT ON COLUMN staff.attendance_tracked IS
  'Whether this staff member is expected to clock in. Governs attendance '
  'EXPECTATION only (loadExpectedAttendanceDays); entries from untracked '
  'staff are still reconciled and paid. Seeded in migration 479 from '
  'observed clock-in history; maintained by HR thereafter.';
