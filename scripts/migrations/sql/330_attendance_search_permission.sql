-- Migration 330: Pulse Search permission (PRD-061 Phase A)
--
-- Adds the new RBAC key `people.staff.attendance.search` that gates the
-- Search page at /staff/attendance/search and its API at
-- /api/staff/attendance-search (+ -search-export). Mirrors the existing
-- `people.staff.attendance.manage` cascade shape: parent_key = 'people.staff'
-- so a viewer blocked on the parent module is also blocked on Search.
--
-- Role grants mirror the existing manage permission with one narrowing:
--   - admin/super_admin/manager/site_supervisor/project_manager: view = true
--   - all other roles: view = false
-- Search is read-only; create/edit/delete are intentionally false everywhere.
--
-- Idempotent: safe to re-run.

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'people.staff.attendance.search', 'people.staff',
   'Attendance Search',
   'Cross-staff, cross-period attendance search and reports (Pulse · Search)',
   '/staff/attendance/search', 15, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin',     'people.staff.attendance.search', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('admin',           'people.staff.attendance.search', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('manager',         'people.staff.attendance.search', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'people.staff.attendance.search', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'people.staff.attendance.search', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',      'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'people.staff.attendance.search', '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Verify (uncomment after apply)
-- SELECT key, parent_key, route FROM access_permissions WHERE key = 'people.staff.attendance.search';
-- SELECT role, actions FROM role_permissions WHERE permission_key = 'people.staff.attendance.search' ORDER BY role;
