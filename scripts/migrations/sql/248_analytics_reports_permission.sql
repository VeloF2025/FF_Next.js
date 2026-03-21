-- =====================================================
-- Migration 248: Analytics Reports Permission
-- Adds analytics.reports tab permission and grants
-- access overrides for Hein and Lew.
-- =====================================================

BEGIN;

-- Insert analytics module permission (parent) if not already present
INSERT INTO access_permissions (type, key, label, description, sort_order, is_active)
VALUES ('module', 'analytics', 'Analytics', 'Analytics and reporting — restricted internal use', 20, true)
ON CONFLICT (key) DO NOTHING;

-- Insert analytics.reports tab permission
INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order, is_active)
VALUES (
  'tab',
  'analytics.reports',
  'analytics',
  'Reports',
  'Analytics reports sandbox — restricted internal use',
  1,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Grant Hein (28ab98c1-df21-48f8-a30a-489cd09a0d39) access
-- ON CONFLICT uses (user_id, permission_key) unique constraint if present
INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, granted_by, granted_at, reason)
VALUES (
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  'analytics.reports',
  'grant',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  NOW(),
  'Analytics sandbox access — internal reporting'
)
ON CONFLICT (user_id, permission_key)
DO UPDATE SET
  override_type = 'grant',
  actions       = '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  granted_by    = '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  granted_at    = NOW(),
  reason        = 'Analytics sandbox access — internal reporting';

-- Grant Lew (7d84184b-2a2b-4fbb-a52e-9815d0e92237) access
INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, granted_by, granted_at, reason)
VALUES (
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237',
  'analytics.reports',
  'grant',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  NOW(),
  'Analytics sandbox access — internal reporting'
)
ON CONFLICT (user_id, permission_key)
DO UPDATE SET
  override_type = 'grant',
  actions       = '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  granted_by    = '28ab98c1-df21-48f8-a30a-489cd09a0d39',
  granted_at    = NOW(),
  reason        = 'Analytics sandbox access — internal reporting';

COMMIT;
