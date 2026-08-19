-- rollback_500_attendance_exception_kinds.sql
--
-- Reverses 500. Note this restores 2,261 exceptions that are known false —
-- only run it alongside reverting the code change, or the queue fills with
-- noise again while the geofence check is still reading an empty table.

UPDATE attendance_exceptions
   SET resolved_at = NULL, resolution_note = NULL
 WHERE resolution_note LIKE 'Auto-resolved by migration 500:%';

UPDATE attendance_exceptions
   SET exception_kind = 'geofence_mismatch'
 WHERE exception_kind = 'low_accuracy';

ALTER TABLE attendance_exceptions
  DROP CONSTRAINT IF EXISTS attendance_exceptions_exception_kind_check;

ALTER TABLE attendance_exceptions
  ADD CONSTRAINT attendance_exceptions_exception_kind_check
  CHECK (exception_kind::text = ANY (ARRAY[
    'missing_clock_out','geofence_mismatch','clock_skew','out_of_hours',
    'manual_override','duplicate_entry','vehicle_gps_mismatch',
    'forgotten_clock_out_retro'
  ]::text[]));
