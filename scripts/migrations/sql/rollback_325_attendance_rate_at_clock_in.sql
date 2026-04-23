-- Rollback for migration 325.
-- Drops the snapshot table. Reconcile falls back to staff.hourly_rate.

DROP TABLE IF EXISTS staff_rate_at_clock_in;
