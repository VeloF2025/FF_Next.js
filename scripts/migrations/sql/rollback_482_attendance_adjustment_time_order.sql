-- Rollback migration 482: drop the adjustment clock ordering constraint.
--
-- Reverting drops the STORAGE-layer guard only. The API keeps its own ordering
-- checks (pages/api/field/attendance-adjust.ts, and
-- corrections/adjustmentMutations.insertAdjustment), so running this rollback
-- alone does NOT restore the pre-482 behaviour end-to-end — requests that the
-- application rejects stay rejected. To genuinely return to the old behaviour
-- the application code must be reverted too.
--
-- What this rollback does restore: any writer that bypasses those code paths
-- (direct SQL, psql, a future service) can once again store a correction whose
-- clock-out precedes its clock-in. Nothing else depends on the constraint.
--
-- Re-runnable: DROP CONSTRAINT is guarded with IF EXISTS, and it clears its
-- own schema_migrations row (that table is keyed on `filename`, not `version`).
-- Without that DELETE the constraint is dropped while the tracker still
-- reports 482 as applied, so the forward runner skips it and the two never
-- reconcile. Matches rollback_461..467, 476, 477, 479.

ALTER TABLE attendance_adjustments
  DROP CONSTRAINT IF EXISTS attendance_adjustments_time_order;

DELETE FROM schema_migrations WHERE filename = '482_attendance_adjustment_time_order.sql';
