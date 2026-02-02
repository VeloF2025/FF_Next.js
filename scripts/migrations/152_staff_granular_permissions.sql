-- =====================================================
-- Migration 152: Staff Module Granular Permissions
-- Adds granular RBAC permissions for Staff sub-pages and detail tabs
-- Adds feature settings for quick toggles
-- =====================================================

-- =====================================================
-- 1. STAFF SUB-PAGES - Add granular page permissions
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order, description) VALUES
    ('page', 'people.staff.list', 'people.staff', 'Staff List', '/staff', 1, 'Staff list and search'),
    ('page', 'people.staff.import', 'people.staff', 'Import', '/staff/import', 2, 'Staff data import'),
    ('page', 'people.staff.alerts', 'people.staff', 'Alerts', '/staff/alerts', 3, 'Staff alerts and notifications'),
    ('page', 'people.staff.birthdays', 'people.staff', 'Birthdays', '/staff/birthdays', 4, 'Staff birthday calendar'),
    ('page', 'people.staff.compliance', 'people.staff', 'Compliance', '/staff/compliance', 5, 'Staff compliance overview'),
    ('page', 'people.staff.departments', 'people.staff', 'Departments', '/staff/departments', 6, 'Department management')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    route = EXCLUDED.route,
    description = EXCLUDED.description;

-- =====================================================
-- 2. STAFF DETAIL TABS - Individual tab permissions
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'people.staff.tabs.overview', 'people.staff', 'Overview Tab', 1, 'Staff member overview'),
    ('tab', 'people.staff.tabs.performance', 'people.staff', 'Performance Tab', 2, 'Performance metrics and reviews'),
    ('tab', 'people.staff.tabs.employment', 'people.staff', 'Employment Tab', 3, 'Employment details (sensitive)'),
    ('tab', 'people.staff.tabs.compliance', 'people.staff', 'Compliance Tab', 4, 'Compliance documents (sensitive)'),
    ('tab', 'people.staff.tabs.vehicles', 'people.staff', 'Vehicles Tab', 5, 'Vehicle assignments'),
    ('tab', 'people.staff.tabs.disciplinary', 'people.staff', 'Disciplinary Tab', 6, 'Disciplinary records (sensitive)'),
    ('tab', 'people.staff.tabs.documents', 'people.staff', 'Documents Tab', 7, 'Staff documents (sensitive)'),
    ('tab', 'people.staff.tabs.projects', 'people.staff', 'Projects Tab', 8, 'Project assignments'),
    ('tab', 'people.staff.tabs.notes', 'people.staff', 'Notes Tab', 9, 'Staff notes'),
    ('tab', 'people.staff.tabs.activity', 'people.staff', 'Activity Tab', 10, 'Activity log')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 3. ADD STAFF FEATURE SETTINGS (for quick toggles)
-- =====================================================
INSERT INTO system_feature_settings (feature_key, enabled, config) VALUES
    -- Staff Sub-Pages
    ('people.staff.list', true, '{"description": "Staff list page"}'::jsonb),
    ('people.staff.import', true, '{"description": "Staff import feature"}'::jsonb),
    ('people.staff.alerts', true, '{"description": "Staff alerts page"}'::jsonb),
    ('people.staff.birthdays', true, '{"description": "Birthdays calendar"}'::jsonb),
    ('people.staff.compliance', true, '{"description": "Compliance overview"}'::jsonb),
    ('people.staff.departments', true, '{"description": "Department management"}'::jsonb),

    -- Staff Detail Tabs
    ('people.staff.tabs.overview', true, '{"description": "Overview tab"}'::jsonb),
    ('people.staff.tabs.performance', true, '{"description": "Performance tab"}'::jsonb),
    ('people.staff.tabs.employment', true, '{"description": "Employment tab (sensitive)"}'::jsonb),
    ('people.staff.tabs.compliance', true, '{"description": "Compliance tab (sensitive)"}'::jsonb),
    ('people.staff.tabs.vehicles', true, '{"description": "Vehicles tab"}'::jsonb),
    ('people.staff.tabs.disciplinary', true, '{"description": "Disciplinary tab (sensitive)"}'::jsonb),
    ('people.staff.tabs.documents', true, '{"description": "Documents tab (sensitive)"}'::jsonb),
    ('people.staff.tabs.projects', true, '{"description": "Projects tab"}'::jsonb),
    ('people.staff.tabs.notes', true, '{"description": "Notes tab"}'::jsonb),
    ('people.staff.tabs.activity', true, '{"description": "Activity tab"}'::jsonb)
ON CONFLICT (feature_key) DO NOTHING;

-- =====================================================
-- 4. SEED ROLE PERMISSIONS FOR STAFF ENTRIES
-- =====================================================

-- Super Admin: Full access to all staff features
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: Full access except delete on sensitive tabs
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key,
    CASE
        WHEN key IN ('people.staff.tabs.disciplinary', 'people.staff.tabs.employment')
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: Full access to non-sensitive, limited sensitive access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key,
    CASE
        WHEN key IN ('people.staff.tabs.disciplinary', 'people.staff.tabs.employment', 'people.staff.tabs.documents')
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: View only, no sensitive tabs
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key IN ('people.staff.tabs.disciplinary', 'people.staff.tabs.employment', 'people.staff.tabs.documents', 'people.staff.tabs.compliance')
            THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key IN ('people.staff.import', 'people.staff.departments')
            THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: View only, no sensitive tabs
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key,
    CASE
        WHEN key IN ('people.staff.tabs.disciplinary', 'people.staff.tabs.employment', 'people.staff.tabs.documents', 'people.staff.tabs.compliance')
            THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key IN ('people.staff.import', 'people.staff.departments')
            THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: Very limited access - only basic tabs
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key,
    CASE
        WHEN key IN ('people.staff.list', 'people.staff.tabs.overview', 'people.staff.tabs.projects')
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'people.staff.%'
ON CONFLICT (role, permission_key) DO NOTHING;
