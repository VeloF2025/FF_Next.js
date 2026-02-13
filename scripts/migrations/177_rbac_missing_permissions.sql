-- =====================================================
-- Migration 177: Add missing RBAC permission entries
--
-- RBAC audit (2026-02-12) found rbacKeys referenced in
-- navigation configs but missing from access_permissions:
--
-- Batch 1 (activate/projects - never seeded or migration 157 not applied):
--   - activate.reports, activate.technicians
--   - projects.progress, projects.health-safety, projects.reports
--
-- Batch 2 (maintenance/system - deleted or migration 097 partially applied):
--   - maintenance.teams, maintenance.handover, maintenance.risks, maintenance.data-sync
--   - system.vlm-learning
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

-- 4. Add missing Maintenance page permissions (from migration 097 seed but missing in DB)
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'maintenance.teams', 'maintenance', 'Teams', '/maintenance/teams', 4),
    ('page', 'maintenance.handover', 'maintenance', 'Handover', '/maintenance/handover', 5),
    ('page', 'maintenance.risks', 'maintenance', 'Risk Acceptance', '/maintenance/risks', 6),
    ('page', 'maintenance.data-sync', 'maintenance', 'Data Sync', '/maintenance/data-sync', 7)
ON CONFLICT (key) DO NOTHING;

-- 5. Add missing System page permissions
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'system.vlm-learning', 'system', 'VLM Learning', '/system/vlm-learning', 10)
ON CONFLICT (key) DO NOTHING;

-- 6. Seed role_permissions for batch 2 keys
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync', 'system.vlm-learning')
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync', 'system.vlm-learning')
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync', 'system.vlm-learning')
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key, '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync', 'system.vlm-learning')
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync', 'system.vlm-learning')
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN ('maintenance.teams', 'maintenance.handover', 'maintenance.risks', 'maintenance.data-sync')
ON CONFLICT (role, permission_key) DO NOTHING;

-- 7. Clean up stale uppercase SUPER_ADMIN role (should be lowercase super_admin)
DELETE FROM role_permissions WHERE role = 'SUPER_ADMIN';
