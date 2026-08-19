-- 500_attendance_exception_kinds.sql
--
-- Splits `low_accuracy` out of `geofence_mismatch`, and clears the backlog
-- of geofence mismatches that were never real.
--
-- Background: `matchGeofence` read `fleet_authorized_locations`, which has 0
-- rows, with `staff.home_site_id` as a fallback, which 0 staff have. It
-- therefore returned inside:false for every clock-in ever recorded and
-- raised a geofence_mismatch on each. Of 2,497 unresolved rows, 2,261 are
-- that bug. The other 236 are low-accuracy GPS warnings, which are real but
-- were filed under the same kind — so the queue could not be triaged even in
-- principle, and in three months nobody resolved a single row.
--
-- The code change alongside this migration repoints the check at
-- `project_aois` (migration 499). This migration makes the label honest and
-- retires the false backlog.

ALTER TABLE attendance_exceptions
  DROP CONSTRAINT IF EXISTS attendance_exceptions_exception_kind_check;

ALTER TABLE attendance_exceptions
  ADD CONSTRAINT attendance_exceptions_exception_kind_check
  CHECK (exception_kind::text = ANY (ARRAY[
    'missing_clock_out','geofence_mismatch','clock_skew','out_of_hours',
    'manual_override','duplicate_entry','vehicle_gps_mismatch',
    'forgotten_clock_out_retro',
    'low_accuracy'
  ]::text[]));

-- Relabel the existing low-accuracy rows. Identified by the marker the
-- writer already set, not by guesswork.
UPDATE attendance_exceptions
   SET exception_kind = 'low_accuracy'
 WHERE exception_kind = 'geofence_mismatch'
   AND details->>'reason' = 'low_accuracy';

-- Retire the false positives. Resolved rather than deleted: they are a real
-- record that the system raised them, and deleting would hide the three
-- months this ran wrong. `resolved_by` stays NULL — no human adjudicated
-- these, and attributing them to one would be a lie in an audit table.
UPDATE attendance_exceptions
   SET resolved_at = NOW(),
       resolution_note = 'Auto-resolved by migration 500: false positive. '
                      || 'matchGeofence evaluated against fleet_authorized_locations, '
                      || 'which has always been empty, so every clock-in was flagged. '
                      || 'Check repointed at project_aois.'
 WHERE exception_kind = 'geofence_mismatch'
   AND resolved_at IS NULL
   AND details->>'reason' IS DISTINCT FROM 'low_accuracy';
