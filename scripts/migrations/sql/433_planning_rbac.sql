-- Migration 433: RBAC — Planning module
-- Registers the `planning` module + `planning.main` page in access_permissions
-- and seeds role_permissions per the Standard matrix. Before this migration the
-- Planning sidebar referenced rbacKey 'planning.main' but no DB row existed, so
-- the API was ungated and the nav showed for everyone.
--
-- Idempotent: safe to re-run (ON CONFLICT DO UPDATE corrects drift).

BEGIN;

-- 1. Permission entries (module + its landing page).
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order)
VALUES
  ('module', 'planning',      NULL,       'Planning',       '/planning', 90),
  ('page',   'planning.main', 'planning', 'Planning Board', '/planning', 1)
ON CONFLICT (key) DO UPDATE
  SET type = EXCLUDED.type,
      parent_key = EXCLUDED.parent_key,
      label = EXCLUDED.label,
      route = EXCLUDED.route,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW();

-- 2. Role grants — Standard matrix, applied to BOTH keys so the parent cascade
--    does not force the page to false. super_admin also bypasses in code.
INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin', 'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('super_admin', 'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('admin',       'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('admin',       'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": true}'::jsonb),
  ('manager',     'planning',      '{"view": true,  "create": true,  "edit": true,  "delete": false}'::jsonb),
  ('manager',     'planning.main', '{"view": true,  "create": true,  "edit": true,  "delete": false}'::jsonb),
  ('technician',  'planning',      '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('technician',  'planning.main', '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('viewer',      'planning',      '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('viewer',      'planning.main', '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
  ('contractor',  'planning',      '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
  ('contractor',  'planning.main', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE
  SET actions = EXCLUDED.actions,
      updated_at = NOW();

COMMIT;
