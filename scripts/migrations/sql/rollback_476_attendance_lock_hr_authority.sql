-- Rollback migration 476: restore the legacy migration-320 manager grant.
-- Bulk-lock remains admin-only because migration 332 already established it.

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('manager', 'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager', 'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO UPDATE
SET actions = EXCLUDED.actions;
