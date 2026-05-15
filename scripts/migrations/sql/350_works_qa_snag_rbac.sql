-- Migration 350: RBAC — Works QA snag actions (create + verify)
-- Adds two new sub-actions under construction-qa.works-qa for the per-photo
-- snag flow shipped in PRs #1633 / #1635 / #1636. Until now the snag API
-- routes reused .override (create path) and .approve (resolve path) as a
-- temporary mapping; this migration introduces the dedicated permissions
-- and the role grants. The route swaps happen in the same PR.
--
-- Locked decisions (Hein 2026-05-14, broader than plan §5 draft):
--   create:  super_admin, admin, manager, project_manager, qa_manager,
--            site_supervisor, contractor, technician
--            (field roles raise snags directly — they're at the photo)
--   verify:  super_admin, admin, qa_manager, project_manager
--            (manager intentionally excluded from verify)
--
-- Note: parent_key is 'construction-qa' (matching the flat convention
-- established by migration 343 for all construction-qa.works-qa.*
-- siblings). A user-level override at the intermediate
-- 'construction-qa.works-qa' node will NOT cascade-block these — that
-- gap exists across the whole sibling set and is out of scope here.
--
-- Mirrors the pattern in migration 343_works_qa_rbac.sql. Idempotent.

-- ============================================================
-- SECTION 1: Permission entries
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'construction-qa.works-qa.snags.create', 'construction-qa', 'Works QA — Create Snag', '/field-ops/works-qa', 9),
    ('page', 'construction-qa.works-qa.snags.verify', 'construction-qa', 'Works QA — Verify Snag', '/field-ops/works-qa', 10)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 2: Role permissions
-- ============================================================

-- 2a. super_admin / admin — full CRUD on both
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM (VALUES ('super_admin'), ('admin')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa.snags.create',
    'construction-qa.works-qa.snags.verify'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2b. qa_manager / project_manager — view + create + edit on both (can create AND verify)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM (VALUES ('qa_manager'), ('project_manager')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa.snags.create',
    'construction-qa.works-qa.snags.verify'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2c. manager — view + create + edit on create only (no verify per locked decision)
INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('manager', 'construction-qa.works-qa.snags.create', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
    ('manager', 'construction-qa.works-qa.snags.verify', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2d. site_supervisor / contractor / technician — create only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, p.actions
FROM (VALUES ('site_supervisor'), ('contractor'), ('technician')) r(role)
CROSS JOIN (VALUES
    ('construction-qa.works-qa.snags.create', '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb),
    ('construction-qa.works-qa.snags.verify', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
) p(key, actions)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2e. viewer / client / storeman / system — no access to either
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
FROM (VALUES ('viewer'), ('client'), ('storeman'), ('system')) r(role)
CROSS JOIN access_permissions p
WHERE p.key IN (
    'construction-qa.works-qa.snags.create',
    'construction-qa.works-qa.snags.verify'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Report
SELECT permission_key, COUNT(*) FILTER (WHERE (actions->>'create')::boolean) AS roles_can_create
FROM role_permissions
WHERE permission_key LIKE 'construction-qa.works-qa.snags.%'
GROUP BY permission_key ORDER BY permission_key;
