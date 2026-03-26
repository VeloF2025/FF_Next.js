-- =====================================================
-- Migration 259: Add DevOps nav items to RBAC
-- Adds devops.schema and devops.field-mapping permission keys
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Add DevOps page permissions
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'devops.schema', 'system', 'Schema Explorer', 'Database schema visualization and exploration', '/devops/schema', 9),
    ('page', 'devops.field-mapping', 'system', 'Field Mapping', 'Database field mapping and relationships', '/devops/field-mapping', 10)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- 2. Grant DevOps permissions to super_admin
-- =====================================================
INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('super_admin', 'devops.schema', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('super_admin', 'devops.field-mapping', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- =====================================================
-- 3. Grant DevOps permissions to admin
-- =====================================================
INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('admin', 'devops.schema', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('admin', 'devops.field-mapping', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- =====================================================
-- 4. No DevOps access for other roles (manager, viewer, etc)
-- =====================================================

COMMIT;
