-- Migration 343: RBAC — Works QA tab (under Construction QA)
-- Adds the Works QA page + the three sensitive sub-actions (approve, override,
-- sync) to access_permissions and seeds role_permissions for every role.
-- Mirrors the Snags pattern (239 + 271). Idempotent.

-- ============================================================
-- SECTION 1: Page + sub-action entries
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'construction-qa.works-qa',          'construction-qa', 'Works QA',          '/field-ops/works-qa', 4),
    ('page', 'construction-qa.works-qa.sync',     'construction-qa', 'Works QA — Sync',   '/field-ops/works-qa', 5),
    ('page', 'construction-qa.works-qa.override', 'construction-qa', 'Works QA — Override','/field-ops/works-qa', 6),
    ('page', 'construction-qa.works-qa.approve',  'construction-qa', 'Works QA — Approve','/field-ops/works-qa', 7),
    ('page', 'construction-qa.works-qa.export',   'construction-qa', 'Works QA — Export', '/field-ops/works-qa', 8)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 2: Role permissions
--
-- Tab visibility ('construction-qa.works-qa'):
--   anyone with view → tab renders + page loads
-- Sensitive sub-actions:
--   .sync       → manager + above (mass-mutates pole_qa_photos)
--   .override   → manager + above (writes to qa_correction_examples)
--   .approve    → manager + above (final sign-off, sets approved_at)
--   .export     → view-only is enough (downloads a ZIP of approved data)
-- ============================================================

-- 2a. super_admin / admin — full CRUD on everything
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM (VALUES ('super_admin'), ('admin')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa',
    'construction-qa.works-qa.sync',
    'construction-qa.works-qa.override',
    'construction-qa.works-qa.approve',
    'construction-qa.works-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2b. manager / project_manager / qa_manager — view + create + edit (no delete)
--     these roles can sync, override, approve
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM (VALUES ('manager'), ('project_manager'), ('qa_manager')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa',
    'construction-qa.works-qa.sync',
    'construction-qa.works-qa.override',
    'construction-qa.works-qa.approve',
    'construction-qa.works-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2c. site_supervisor — view + create (can upload photos but cannot approve/override)
--     view on the tab + create on sync (re-pull), no override/approve
INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('site_supervisor', 'construction-qa.works-qa',        '{"view": true,  "create": true,  "edit": true,  "delete": false}'::jsonb),
    ('site_supervisor', 'construction-qa.works-qa.sync',   '{"view": true,  "create": true,  "edit": false, "delete": false}'::jsonb),
    ('site_supervisor', 'construction-qa.works-qa.export', '{"view": true,  "create": false, "edit": false, "delete": false}'::jsonb),
    ('site_supervisor', 'construction-qa.works-qa.override','{"view": false,"create": false, "edit": false, "delete": false}'::jsonb),
    ('site_supervisor', 'construction-qa.works-qa.approve','{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2d. technician / contractor — view + upload only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, p.actions
FROM (VALUES ('technician'), ('contractor')) r(role)
CROSS JOIN (VALUES
    ('construction-qa.works-qa',          '{"view": true, "create": true,  "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.export',   '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.sync',     '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.override', '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.approve',  '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb)
) p(key, actions)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2e. viewer / client — read-only view of the tab + ZIP download
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, p.actions
FROM (VALUES ('viewer'), ('client')) r(role)
CROSS JOIN (VALUES
    ('construction-qa.works-qa',          '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.export',   '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.sync',     '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.override', '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.approve',  '{"view": false,"create": false, "edit": false, "delete": false}'::jsonb)
) p(key, actions)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2f. storeman / system — no access (not their workflow)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
FROM (VALUES ('storeman'), ('system')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa',
    'construction-qa.works-qa.sync',
    'construction-qa.works-qa.override',
    'construction-qa.works-qa.approve',
    'construction-qa.works-qa.export'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Report
SELECT permission_key, COUNT(*) FILTER (WHERE (actions->>'view')::boolean) AS roles_with_view
FROM role_permissions
WHERE permission_key LIKE 'construction-qa.works-qa%'
GROUP BY permission_key ORDER BY permission_key;
