-- Migration 401: RBAC — SiteCam Appeals tab (under Activate)
-- Registers activate.sitecam-appeals in access_permissions and seeds
-- role_permissions by mirroring the existing activate.qa-centre grants.
--
-- Before this migration, activate.sitecam-appeals was referenced by the
-- Activate nav config (PR #1910) but had no DB row, so
-- can('activate.sitecam-appeals', 'view') returned false for every
-- non-super_admin user (usePermission.ts: `if (!perm) return false`),
-- hiding the tab for everyone except super admins.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1. Permission entry (sort_order 12 follows activate.reports=10, .technicians=11)
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order)
VALUES ('tab', 'activate.sitecam-appeals', 'activate', 'SiteCam Appeals', '/activate/sitecam-appeals', 12)
ON CONFLICT (key) DO NOTHING;

-- 2. Role grants — mirror the sibling activate.qa-centre tab exactly so
--    visibility matches the rest of the Activate module rather than
--    hand-picking a new role set.
INSERT INTO role_permissions (role, permission_key, actions)
SELECT role, 'activate.sitecam-appeals', actions
FROM role_permissions
WHERE permission_key = 'activate.qa-centre'
ON CONFLICT (role, permission_key) DO NOTHING;

COMMIT;
