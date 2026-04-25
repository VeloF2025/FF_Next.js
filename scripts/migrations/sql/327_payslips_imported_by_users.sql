-- Migration 327: payslips.imported_by → users(id)
--
-- Migration 326 created payslips.imported_by referencing staff(id), but
-- the import endpoint authenticates via withAuth which exposes a user
-- record (users table), not a staff record. Hein's auth user id and
-- staff id are different UUIDs — every commit hit the FK violation
-- "insert or update ... violates foreign key constraint
-- payslips_imported_by_fkey".
--
-- The semantic is "which admin imported this", not "which staff member
-- owns this", so users(id) is correct.

ALTER TABLE payslips
  DROP CONSTRAINT IF EXISTS payslips_imported_by_fkey;

ALTER TABLE payslips
  ADD CONSTRAINT payslips_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
