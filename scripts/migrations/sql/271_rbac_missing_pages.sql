-- =====================================================
-- Migration 271: RBAC - Add missing page/tab permissions
-- Fills gaps where rbacKeys are used in UI navigation
-- but have no corresponding access_permissions entry
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Missing page: tracker
-- =====================================================
INSERT INTO access_permissions (type, key, label, description, route, sort_order) VALUES
    ('module', 'tracker', 'Project Tracker', 'Project tracking and status overview', '/tracker', 19)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 2. Missing page: devops.qfield-mapping
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'devops.qfield-mapping', 'system', 'QField Mapping', 'QField layer and feature mapping configuration', '/devops/qfield-mapping', 11)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- 3. Missing tabs: Fleet (import, mileage)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('tab', 'fleet.import', 'fleet', 'Import', 'Fleet data import', '/fleet/import', 14),
    ('tab', 'fleet.mileage', 'fleet', 'Mileage', 'Vehicle mileage tracking', '/fleet/mileage', 15)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- 4. Missing tabs: NOC (data-sync, handover, risks)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('tab', 'noc.data-sync', 'noc', 'Data Sync', 'NOC data synchronisation', '/noc/data-sync', 9),
    ('tab', 'noc.handover', 'noc', 'Handover', 'NOC shift handover management', '/noc/handover', 10),
    ('tab', 'noc.risks', 'noc', 'Risk Acceptances', 'Risk acceptance tracking', '/noc/risks', 11)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- 5. Grant permissions to roles
-- =====================================================

-- Super Admin: full access to all new permissions
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('super_admin', 'tracker', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'devops.qfield-mapping', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'fleet.import', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'fleet.mileage', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'noc.data-sync', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'noc.handover', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('super_admin', 'noc.risks', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: full access (no delete on devops)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('admin', 'tracker', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'devops.qfield-mapping', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('admin', 'fleet.import', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'fleet.mileage', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'noc.data-sync', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'noc.handover', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'noc.risks', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: view + create/edit, no delete
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('manager', 'tracker', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('manager', 'devops.qfield-mapping', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('manager', 'fleet.import', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('manager', 'fleet.mileage', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('manager', 'noc.data-sync', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('manager', 'noc.handover', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('manager', 'noc.risks', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: view-only (no devops)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('viewer', 'tracker', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'devops.qfield-mapping', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'fleet.import', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'fleet.mileage', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'noc.data-sync', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'noc.handover', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('viewer', 'noc.risks', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: NOC access, view tracker
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('technician', 'tracker', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('technician', 'devops.qfield-mapping', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('technician', 'fleet.import', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('technician', 'fleet.mileage', '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb),
    ('technician', 'noc.data-sync', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('technician', 'noc.handover', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('technician', 'noc.risks', '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Storeman: view tracker only
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('storeman', 'tracker', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'devops.qfield-mapping', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'fleet.import', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'fleet.mileage', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'noc.data-sync', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'noc.handover', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('storeman', 'noc.risks', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: view NOC handover/risks only
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
    ('contractor', 'tracker', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'devops.qfield-mapping', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'fleet.import', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'fleet.mileage', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'noc.data-sync', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'noc.handover', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('contractor', 'noc.risks', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

COMMIT;
