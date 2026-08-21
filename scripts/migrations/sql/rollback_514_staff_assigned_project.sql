-- Rollback 514_staff_assigned_project.sql
--
-- Drops the admin site assignment. Deliberately does NOT null out
-- stock_locations.project_id: that mapping is correct reference data that other
-- reporting may come to rely on, and re-deriving it needs a human decision
-- (see the migration header). Null it by hand if the rollback truly requires it.
DROP INDEX IF EXISTS idx_staff_assigned_project;
ALTER TABLE staff
  DROP COLUMN IF EXISTS assigned_project_by,
  DROP COLUMN IF EXISTS assigned_project_at,
  DROP COLUMN IF EXISTS assigned_project_id;
