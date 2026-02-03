-- =====================================================
-- Migration 157: Add missing module tab permissions
-- Adds granular tab-level permissions for Fleet, Staff, Projects, and Maintenance
-- =====================================================

-- Staff tab permissions (under people.staff)
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    ('tab', 'people.staff.departments', 'people.staff', 'Departments', 1),
    ('tab', 'people.staff.alerts', 'people.staff', 'Alerts', 2),
    ('tab', 'people.staff.birthdays', 'people.staff', 'Birthdays', 3),
    ('tab', 'people.staff.compliance', 'people.staff', 'Compliance', 4),
    ('tab', 'people.staff.import', 'people.staff', 'Import', 5)
ON CONFLICT (key) DO NOTHING;

-- Projects tab permissions
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('tab', 'projects.pipeline', 'projects', 'Pipeline', '/projects/pipeline', 1),
    ('tab', 'projects.progress', 'projects', 'Progress', '/projects/progress', 2),
    ('tab', 'projects.health-safety', 'projects', 'Health & Safety', '/projects/health-safety', 3),
    ('tab', 'projects.reports', 'projects', 'Reports', '/projects/reports', 4)
ON CONFLICT (key) DO NOTHING;

-- Maintenance tab permissions
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('tab', 'maintenance.teams', 'maintenance', 'Teams', '/maintenance/teams', 1),
    ('tab', 'maintenance.data-sync', 'maintenance', 'Data Sync', '/maintenance/data-sync', 2),
    ('tab', 'maintenance.escalations', 'maintenance', 'Escalations', '/maintenance/escalations', 3),
    ('tab', 'maintenance.handover', 'maintenance', 'Handover', '/maintenance/handover', 4),
    ('tab', 'maintenance.risks', 'maintenance', 'Risk Acceptance', '/maintenance/risks', 5)
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- Grant permissions to roles
-- =====================================================

-- Super Admin: Full access to new permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'people.staff.departments', 'people.staff.alerts', 'people.staff.birthdays',
    'people.staff.compliance', 'people.staff.import',
    'projects.pipeline', 'projects.progress', 'projects.health-safety', 'projects.reports',
    'maintenance.teams', 'maintenance.data-sync', 'maintenance.escalations',
    'maintenance.handover', 'maintenance.risks'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: Full access except delete
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'people.staff.departments', 'people.staff.alerts', 'people.staff.birthdays',
    'people.staff.compliance', 'people.staff.import',
    'projects.pipeline', 'projects.progress', 'projects.health-safety', 'projects.reports',
    'maintenance.teams', 'maintenance.data-sync', 'maintenance.escalations',
    'maintenance.handover', 'maintenance.risks'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: View and create/edit
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'people.staff.departments', 'people.staff.alerts', 'people.staff.birthdays',
    'people.staff.compliance', 'people.staff.import',
    'projects.pipeline', 'projects.progress', 'projects.health-safety', 'projects.reports',
    'maintenance.teams', 'maintenance.data-sync', 'maintenance.escalations',
    'maintenance.handover', 'maintenance.risks'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: View only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'people.staff.departments', 'people.staff.alerts', 'people.staff.birthdays',
    'people.staff.compliance', 'people.staff.import',
    'projects.pipeline', 'projects.progress', 'projects.health-safety', 'projects.reports',
    'maintenance.teams', 'maintenance.data-sync', 'maintenance.escalations',
    'maintenance.handover', 'maintenance.risks'
)
ON CONFLICT (role, permission_key) DO NOTHING;
