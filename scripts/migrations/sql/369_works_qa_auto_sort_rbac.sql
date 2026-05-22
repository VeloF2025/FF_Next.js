-- Migration 369: RBAC — Works QA auto-sort
-- Adds a new sub-action under construction-qa.works-qa for the AI
-- auto-sort classifier endpoint shipped in PR 3 of the Johan sweep.
-- POST /api/works-qa/auto-sort is gated by
-- withPermission('construction-qa.works-qa.auto-sort', 'create').
--
-- Grant set mirrors the existing 'construction-qa.works-qa' create
-- holders (= the same roles that already drag-drop / re-categorise
-- photos): super_admin, admin, manager, project_manager, qa_manager,
-- site_supervisor, contractor, technician.
--
-- Mirrors migration 350_works_qa_snag_rbac.sql. Idempotent.

-- ============================================================
-- SECTION 1: Permission entry
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'construction-qa.works-qa.auto-sort', 'construction-qa', 'Works QA — AI Auto-Sort', '/field-ops/works-qa', 11)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 2: Role permissions
-- ============================================================

-- 2a. super_admin / admin — full CRUD
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, 'construction-qa.works-qa.auto-sort', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM (VALUES ('super_admin'), ('admin')) r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2b. qa_manager / project_manager / manager — view + create + edit
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, 'construction-qa.works-qa.auto-sort', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM (VALUES ('qa_manager'), ('project_manager'), ('manager')) r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2c. site_supervisor / contractor / technician — view + create only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, 'construction-qa.works-qa.auto-sort', '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
FROM (VALUES ('site_supervisor'), ('contractor'), ('technician')) r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 2d. viewer / client / storeman / system — no access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, 'construction-qa.works-qa.auto-sort', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
FROM (VALUES ('viewer'), ('client'), ('storeman'), ('system')) r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO migrations (version, name, executed_at)
VALUES ('369', 'works_qa_auto_sort_rbac', NOW())
ON CONFLICT (version) DO NOTHING;
