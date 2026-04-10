-- Migration: Ensure NOC sidebar visibility for admin/manager/super_admin roles
-- Ticket: VF-20260409-009 — NOC sidebar missing for some users
-- Root cause: noc.main permission not granted to all appropriate roles

BEGIN;

-- Ensure noc.main permission exists
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order)
VALUES ('page', 'noc.main', 'noc', 'NOC Dashboard', 'Main NOC ticket list and overview', '/noc', 1)
ON CONFLICT (key) DO NOTHING;

-- Grant noc.main to admin, super_admin, manager roles (full access)
INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('super_admin', 'noc.main', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('admin', 'noc.main', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
    ('manager', 'noc.main', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE SET
    actions = EXCLUDED.actions;

COMMIT;
