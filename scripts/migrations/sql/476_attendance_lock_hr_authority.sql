-- Migration 476: constrain payroll week locks to FibreFlow HR administrators.
-- FibreFlow has no separate HR auth role; admin and super_admin are the
-- current HR authority roles. Manager keeps read-only visibility.

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin', 'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'people.staff.attendance.locks', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',     'people.staff.attendance.locks', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('super_admin', 'people.staff.attendance.bulk_lock', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('admin',       'people.staff.attendance.bulk_lock', '{"view":true,"create":true,"edit":false,"delete":false}'),
  ('manager',     'people.staff.attendance.bulk_lock', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO UPDATE
SET actions = EXCLUDED.actions;
