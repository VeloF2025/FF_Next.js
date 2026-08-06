-- Rollback migration 482: drop the adjustment clock ordering constraint.
--
-- Reverting restores the previous behaviour: a correction may store a
-- clock-out that precedes its clock-in, producing a negative shift duration
-- that flows into payroll if approved. Nothing else depends on the constraint.
--
-- Re-runnable: DROP CONSTRAINT is guarded with IF EXISTS, and it clears its
-- own schema_migrations row (that table is keyed on `filename`, not `version`).
-- Without that DELETE the constraint is dropped while the tracker still
-- reports 482 as applied, so the forward runner skips it and the two never
-- reconcile. Matches rollback_461..467, 476, 477, 479.

ALTER TABLE attendance_adjustments
  DROP CONSTRAINT IF EXISTS attendance_adjustments_time_order;

DELETE FROM schema_migrations WHERE filename = '482_attendance_adjustment_time_order.sql';
