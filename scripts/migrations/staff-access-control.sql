-- Staff Module Access Control Migration
-- Adds permission for sensitive staff data access and grants to HR admins
-- Created: 2026-02-01

-- Add sensitive staff permission
INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order)
VALUES ('page', 'people.staff.sensitive', 'people.staff', 'Staff Sensitive Data',
        'Access to salary, bank details, ID numbers, and documents', 1)
ON CONFLICT (key) DO NOTHING;

-- Grant full sensitive access to HR admins
-- Hein van Vuuren
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason)
VALUES (
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  'people.staff.sensitive',
  'grant',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  'HR admin access - full sensitive data'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  actions = EXCLUDED.actions,
  reason = EXCLUDED.reason,
  granted_at = NOW();

-- Melanie Odendaal
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason)
VALUES (
  '7df939e1-a62d-4436-af73-d5bef5e49dbc',
  'people.staff.sensitive',
  'grant',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  'HR admin access - full sensitive data'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  actions = EXCLUDED.actions,
  reason = EXCLUDED.reason,
  granted_at = NOW();

-- Mishke Tauber
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason)
VALUES (
  '45944704-44e3-4d5b-ba2a-a6f64c06e36d',
  'people.staff.sensitive',
  'grant',
  '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  'HR admin access - full sensitive data'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  actions = EXCLUDED.actions,
  reason = EXCLUDED.reason,
  granted_at = NOW();

-- Verification query (run after migration)
-- SELECT u.email, u.first_name, u.last_name, upo.permission_key, upo.actions
-- FROM user_permission_overrides upo
-- JOIN users u ON u.id = upo.user_id
-- WHERE upo.permission_key = 'people.staff.sensitive';
