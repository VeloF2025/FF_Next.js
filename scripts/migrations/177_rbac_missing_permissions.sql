-- =====================================================
-- Migration 177: Add missing RBAC permission entries
--
-- RBAC audit (2026-02-12) found 5 rbacKeys referenced in
-- navigation configs but missing from access_permissions:
--   - activate.reports, activate.technicians (never seeded)
--   - projects.progress, projects.health-safety, projects.reports
--     (in migration 157 but may not have been applied)
--
-- Also cleans up stale uppercase SUPER_ADMIN role entry.
-- =====================================================

-- 1. Add missing Activate tab permissions
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('tab', 'activate.reports', 'activate', 'Reports', '/activate/reports', 10),
    ('tab', 'activate.technicians', 'activate', 'Technicians', '/activate/technicians', 11)
ON CONFLICT (key) DO NOTHING;

-- 2. Ensure Projects tab permissions exist (from migration 157)
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('tab', 'projects.progress', 'projects', 'Execution / Progress', '/projects/progress', 10),
    ('tab', 'projects.health-safety', 'projects', 'Health & Safety', '/projects/health-safety', 11),
    ('tab', 'projects.reports', 'projects', 'Reports', '/projects/reports', 12)
ON CONFLICT (key) DO NOTHING;

-- 3. Seed role_permissions for all 5 new keys
-- Super Admin: Full access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports', 'activate.technicians',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: Full access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports', 'activate.technicians',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: View, create, edit (no delete)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports', 'activate.technicians',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: View and create
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key, '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports', 'activate.technicians',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: View only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports', 'activate.technicians',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: View only for reports, no technician access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'activate.reports',
    'projects.progress', 'projects.health-safety', 'projects.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4. Clean up stale uppercase SUPER_ADMIN role (should be lowercase super_admin)
DELETE FROM role_permissions WHERE role = 'SUPER_ADMIN';
