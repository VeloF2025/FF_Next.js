-- =====================================================
-- Migration 272: RBAC Cleanup + Site Diary Seeding
-- 1. Fix orphan permissions
-- 2. Seed site-diary RBAC permissions
-- 3. Tighten contractor role (remove people/system view)
-- 4. Add 90-day expiry to bulk overrides
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Fix orphan permissions
-- =====================================================

-- Orphan: drops.dashboard — parent 'drops' doesn't exist
-- Clean up from all tables
DELETE FROM user_permission_overrides WHERE permission_key = 'drops.dashboard';
DELETE FROM role_permissions WHERE permission_key = 'drops.dashboard';
DELETE FROM access_permissions WHERE key = 'drops.dashboard';

-- Orphan: procurement.pipelines.discard — parent 'procurement.pipelines' missing
-- Add the missing parent so the hierarchy is valid
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order)
VALUES ('page', 'procurement.pipelines', 'procurement', 'Pipelines', 'Procurement pipelines', '/procurement/pipelines', 6)
ON CONFLICT (key) DO NOTHING;

-- Seed role_permissions for the new parent (mirror sourcing permissions)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('super_admin', 'procurement.pipelines', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'procurement.pipelines', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('manager', 'procurement.pipelines', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('technician', 'procurement.pipelines', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'procurement.pipelines', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'procurement.pipelines', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'procurement.pipelines', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- =====================================================
-- 2. Seed site-diary RBAC permissions
-- =====================================================

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order)
VALUES ('page', 'projects.site-diary', 'projects', 'Site Diary', 'Construction site diary entries', '/site-diary', 10)
ON CONFLICT (key) DO NOTHING;

-- Role permissions for site-diary
-- super_admin, admin: full CRUD
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('super_admin', 'projects.site-diary', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'projects.site-diary', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- manager, technician: view/create/edit (field workers submit entries)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('manager', 'projects.site-diary', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('technician', 'projects.site-diary', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- viewer: view only
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('viewer', 'projects.site-diary', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- contractor: view + create (submit diary entries in the field)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('contractor', 'projects.site-diary', '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- storeman: no access
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('storeman', 'projects.site-diary', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- =====================================================
-- 3. Tighten contractor role
-- =====================================================

-- Revoke contractor view on people.staff (sensitive HR data)
UPDATE role_permissions
SET actions = '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
WHERE role = 'contractor'
AND permission_key IN ('people.staff.list', 'people.staff.tabs.overview', 'people.staff.tabs.projects');

-- Revoke contractor view on system.vlm-learning (internal dev tool)
UPDATE role_permissions
SET actions = '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
WHERE role = 'contractor'
AND permission_key = 'system.vlm-learning';

-- =====================================================
-- 4. Add 90-day expiry to bulk overrides
-- =====================================================

-- Overrides created via "Batch permission update" or "Toggled view from Modules tab"
-- that have no expiry will expire in 90 days, forcing a review
UPDATE user_permission_overrides
SET expires_at = NOW() + INTERVAL '90 days'
WHERE (reason LIKE 'Batch permission%' OR reason LIKE 'Toggled view%')
  AND expires_at IS NULL;

COMMIT;
