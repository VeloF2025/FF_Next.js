-- Migration 239: RBAC — Construction QA Module
-- Adds construction-qa module + page permissions and seeds role_permissions.
-- All INSERTs are idempotent (ON CONFLICT DO NOTHING).

-- ============================================================
-- SECTION 1: Module entry
-- ============================================================

INSERT INTO access_permissions (type, key, label, description, sort_order) VALUES
    ('module', 'construction-qa', 'Construction QA', 'Civil, optical, and splicing quality assurance', 8)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 2: Page entries
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'construction-qa.qa-centre', 'construction-qa', 'QA Centre',     '/field-ops',         1),
    ('page', 'construction-qa.otdr',      'construction-qa', 'OTDR Testing',  '/field-ops/otdr',    2),
    ('page', 'construction-qa.reports',   'construction-qa', 'Reports',       '/field-ops/reports', 3),
    ('page', 'construction-qa.export',    'construction-qa', 'Export',        '/field-ops/export',  4)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 3: Role permissions
-- ============================================================

-- 3a. super_admin — full CRUD on all construction-qa permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3b. admin — full CRUD
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3c. manager — view + create + edit (no delete)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3d. project_manager — view + create + edit (no delete)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'project_manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3e. site_supervisor — view + create + edit (no delete)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'site_supervisor', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3f. technician — submit (create + edit on qa-centre), view-only on reports/export
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key = 'construction-qa.qa-centre'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3g. contractor — submit (create + edit on qa-centre), view-only on reports
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key,
    CASE
        WHEN key = 'construction-qa.qa-centre'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3h. client — view-only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'client', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3i. viewer — view-only on all
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'construction-qa',
    'construction-qa.qa-centre',
    'construction-qa.otdr',
    'construction-qa.reports',
    'construction-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;
