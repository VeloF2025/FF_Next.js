-- Rollback migration 479.
-- scripts/migrations/run.ts owns the surrounding transaction.
--
-- Restoring the entries and summaries is exact: 479 copied every value it
-- changed into attendance_legacy_autoclose_backup before touching it, notes
-- included, so nothing is reconstructed by guesswork.
--
-- One deliberate asymmetry, in the same spirit as rollback_478.
--
-- This rollback does NOT undo a reprojection. If the reconciler has already run
-- over the reopened window, attendance_daily_summaries carries projection
-- columns and attendance_day_exceptions carries missing_clock_out rows derived
-- from the cleared evidence. Deleting those would destroy supervisor and worker
-- decisions recorded against them — the exact audit trail the attendance
-- workflow exists to keep. Restoring the fabricated clock-outs underneath them
-- therefore leaves projections that disagree with their evidence.
--
-- So: after running this rollback, re-run the reconciler over the same window
-- to re-derive the projections from the restored evidence:
--   npx tsx scripts/cron/attendance-reconcile.ts --from=2026-04-25 --to=<yesterday SAST>
--
-- The backup table is dropped last, after its contents have been restored. A
-- later re-apply of 479 re-derives the same rows from the same predicate, so
-- the apply/rollback cycle is stable.

UPDATE attendance_daily_summaries s
SET regular_hrs = b.regular_hrs,
    overtime_hrs = b.overtime_hrs,
    sunday_hrs = b.sunday_hrs,
    holiday_hrs = b.holiday_hrs,
    night_hrs = b.night_hrs,
    computed_at = NOW()
FROM attendance_legacy_autoclose_backup b
WHERE s.staff_id = b.staff_id
  AND s.work_date = b.work_date
  AND b.regular_hrs IS NOT NULL;

UPDATE attendance_entries e
SET clock_out_at = b.clock_out_at,
    received_at_out = b.received_at_out,
    notes = b.notes,
    updated_at = NOW()
FROM attendance_legacy_autoclose_backup b
WHERE b.entry_id = e.id
  AND e.clock_out_at IS DISTINCT FROM b.clock_out_at;

UPDATE attendance_schedule_policies
SET active_from = DATE '2026-08-03'
WHERE active_from = DATE '2026-04-25'
  AND active_to IS NULL;

DROP TABLE IF EXISTS attendance_legacy_autoclose_backup;

DELETE FROM schema_migrations
WHERE filename = '479_attendance_legacy_autoclose_evidence_reset.sql';
