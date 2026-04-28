-- migrations/2026-04-28-payslips-super-admin-only.sql
-- Lock payslip access to super_admin only.
--
-- Migration 326 originally granted full access to both super_admin and admin.
-- Per Hein's decision (2026-04-28) payroll is sensitive enough that even the
-- admin role should not see the importer or imported payslips — only the
-- director-level super_admin role does. Staff still see their own payslips
-- on /my/payslips via the self-service path (no permission required there).
--
-- Prior state (for rollback / audit reference):
--   admin       payslips         {"edit": true, "view": true, "create": true, "delete": true}
--   admin       payslips.import  {"edit": true, "view": true, "create": true, "delete": true}
-- To roll back manually, restore those JSONB values.
--
-- Note: this migration was already applied to the shared dev/prod Supabase
-- on 2026-04-28 during PR #1504 testing. Tracking in the repo so a fresh-DB
-- rebuild lands in the same state.

DO $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE role_permissions
  SET actions = '{"edit": false, "view": false, "create": false, "delete": false}'::jsonb
  WHERE role = 'admin'
    AND permission_key IN ('payslips', 'payslips.import');

  GET DIAGNOSTICS affected = ROW_COUNT;

  -- The two rows must exist in role_permissions; if migration 326 hasn't
  -- run yet, this assertion catches the ordering bug instead of silently
  -- no-op'ing.
  IF affected <> 2 THEN
    RAISE EXCEPTION 'expected to update 2 rows (admin × {payslips, payslips.import}), but updated %.', affected;
  END IF;
END $$;
