-- Clear the fabricated clock-out evidence written by the pre-#2351 reconciler,
-- and open the schedule policy far enough back that those days can be
-- reprojected honestly.
--
-- Deliberately unwrapped: run-pending-migrations.sh supplies the transaction.
--
-- Background
-- ----------
-- Until PR #2351 the reconcile cron closed a dangling entry by stamping
-- clock_in_at + a 9h cap into clock_out_at, then inserted the matching
-- missing_clock_out exception in a SEPARATE, un-transacted statement. That
-- INSERT built its details with jsonb_build_object(..., ${row.clock_in_at})
-- through the Neon shim with no cast, so PostgreSQL could not infer the
-- parameter type and every call failed with 42P08. The UPDATE had already
-- committed. Across the entire life of the table this produced:
--
--   607 entries, 48 staff, 2026-04-25 .. 2026-08-01
--   every one closed at exactly clock_in_at + INTERVAL '9 hours'
--   zero missing_clock_out exceptions ever written — attendance_exceptions
--     holds only geofence_mismatch (2139) and vehicle_gps_mismatch (19)
--   5463 fabricated hours in attendance_daily_summaries.regular_hrs
--
-- Nothing was ever paid from this data: wage_amount_cents IS NULL on all 607,
-- no day reached result_status = 'locked', and there are no weekly locks and no
-- payroll exports. The damage is confined to management reporting.
--
-- What this migration does
-- ------------------------
-- Copies every value it is about to change into
-- attendance_legacy_autoclose_backup, clears the synthetic clock-out, zeroes
-- the legacy hour columns those clock-outs fed, and moves the schedule policy's
-- active_from back to 2026-04-25 so the reconciler can reach those days.
--
-- Entries keep status = 'auto_closed' with a NULL clock_out_at. That is exactly
-- the state the current systemCloseEntry writes — an operational closure with
-- no clock-out evidence — so it is the shape the post-#2351 code expects.
--
-- Reprojection is a SEPARATE operational step, not part of this migration:
--   npx tsx scripts/cron/attendance-reconcile.ts --from=2026-04-25 --to=<yesterday SAST>
-- It requires the calculateDailyResult guard from PR #2362 to be deployed
-- first. That guard is what stops a system-sourced clock-out being scored as
-- real evidence; without it a replay would relabel these days as plausible
-- early departures instead of surfacing the missing clock-out.

CREATE TABLE IF NOT EXISTS attendance_legacy_autoclose_backup (
  entry_id         UUID PRIMARY KEY,
  staff_id         UUID NOT NULL,
  work_date        DATE NOT NULL,
  clock_out_at     TIMESTAMPTZ,
  received_at_out  TIMESTAMPTZ,
  notes            TEXT,
  regular_hrs      NUMERIC,
  overtime_hrs     NUMERIC,
  sunday_hrs       NUMERIC,
  holiday_hrs      NUMERIC,
  night_hrs        NUMERIC,
  backed_up_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE attendance_legacy_autoclose_backup IS
  'Pre-migration-479 values for auto-closed entries carrying a fabricated '
  'clock_out_at (clock_in_at + 9h) and no missing_clock_out exception. Restore '
  'source for rollback_479. Do not drop while 479 is applied.';

-- The 9h-exact signature plus the absence of a missing_clock_out exception is
-- what identifies a fabricated closure. The exception guard means a closure
-- that was correctly flagged is never touched — there are none today, but it
-- keeps the predicate self-describing if this is applied to another database.
INSERT INTO attendance_legacy_autoclose_backup (
  entry_id, staff_id, work_date, clock_out_at, received_at_out, notes,
  regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs
)
SELECT e.id, e.staff_id, e.work_date, e.clock_out_at, e.received_at_out, e.notes,
       s.regular_hrs, s.overtime_hrs, s.sunday_hrs, s.holiday_hrs, s.night_hrs
FROM attendance_entries e
LEFT JOIN attendance_daily_summaries s
  ON s.staff_id = e.staff_id AND s.work_date = e.work_date
WHERE e.status = 'auto_closed'
  AND e.clock_out_at IS NOT NULL
  AND e.clock_out_at - e.clock_in_at = INTERVAL '9 hours'
  AND NOT EXISTS (
    SELECT 1 FROM attendance_exceptions x
    WHERE x.entry_id = e.id AND x.exception_kind = 'missing_clock_out'
  )
ON CONFLICT (entry_id) DO NOTHING;

-- Zero the legacy hour columns before clearing the entries, so the backup is
-- the only place the fabricated figures survive. NOT NULL with a 0.00 default,
-- so zero is the only available "no claim" value; the honest reading of the day
-- lands in the projection columns and the missing_clock_out exception once the
-- reprojection runs. The inequality guard makes this rerunnable.
UPDATE attendance_daily_summaries s
SET regular_hrs = 0, overtime_hrs = 0, sunday_hrs = 0,
    holiday_hrs = 0, night_hrs = 0, computed_at = NOW()
FROM attendance_legacy_autoclose_backup b
WHERE s.staff_id = b.staff_id
  AND s.work_date = b.work_date
  AND (s.regular_hrs <> 0 OR s.overtime_hrs <> 0 OR s.sunday_hrs <> 0
       OR s.holiday_hrs <> 0 OR s.night_hrs <> 0);

-- clock_out_at IS NOT NULL keeps this rerunnable and stops the note being
-- appended twice.
UPDATE attendance_entries e
SET clock_out_at = NULL,
    received_at_out = NULL,
    updated_at = NOW(),
    notes = CONCAT_WS(E'\n', NULLIF(e.notes, ''),
      '[migration 479: synthetic clock-out cleared; original preserved in attendance_legacy_autoclose_backup]')
FROM attendance_legacy_autoclose_backup b
WHERE b.entry_id = e.id
  AND e.clock_out_at IS NOT NULL;

-- Open the policy back to the first fabricated closure so the reconciler's
-- policy-coverage predicates stop excluding those days.
UPDATE attendance_schedule_policies
SET active_from = DATE '2026-04-25'
WHERE active_from = DATE '2026-08-03'
  AND active_to IS NULL;
