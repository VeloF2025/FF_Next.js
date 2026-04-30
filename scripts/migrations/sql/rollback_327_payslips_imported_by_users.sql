-- Rollback for migration 327.
-- Restore the original (broken) FK to staff(id). Will only work if no
-- existing rows reference a users.id that doesn't have a matching
-- staff.id with the same UUID.

ALTER TABLE payslips
  DROP CONSTRAINT IF EXISTS payslips_imported_by_fkey;

ALTER TABLE payslips
  ADD CONSTRAINT payslips_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES staff(id) ON DELETE SET NULL;
