-- Rollback migration 476: restore the legacy migration-320 manager grant.
-- Bulk-lock remains admin-only because migration 332 already established it.
--
-- Re-runnable: the INSERT is idempotent via ON CONFLICT, and it clears its own
-- schema_migrations row (that table is keyed on `filename`, not `version`). Without that
-- DELETE the grant is restored while the tracker still reports 476 as applied, so the
-- forward runner skips it and the two never reconcile. Matches rollback_461..467, 477.

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('manager', 'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager', 'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO UPDATE
SET actions = EXCLUDED.actions;

DELETE FROM schema_migrations WHERE filename = '476_attendance_lock_hr_authority.sql';
