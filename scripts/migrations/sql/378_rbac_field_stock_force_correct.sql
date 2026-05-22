-- Migration 378: RBAC — procurement.field-stock.force-correct
-- Adds a new action-type permission under 'procurement.field-stock' that
-- allows bypassing state-machine validation and directly setting
-- status/location/project/drop/OLT on stock_serials, with a mandatory
-- audit-trail row written to stock_serial_events.
--
-- Only super_admin is granted this (view + edit). No other roles receive
-- access because force-correct is a privileged escape hatch.
--
-- Idempotent: both INSERTs use ON CONFLICT guards.

BEGIN;

-- ============================================================
-- SECTION 1: Register permission in the access_permissions catalogue
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order)
VALUES (
  'action',
  'procurement.field-stock.force-correct',
  'procurement.field-stock',
  'Force-correct serial state',
  'Bypass state-machine validation and directly set status/location/project/drop/OLT on stock_serials. Writes audit-trail row to stock_serial_events.',
  100
)
ON CONFLICT (key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  parent_key  = EXCLUDED.parent_key;

-- ============================================================
-- SECTION 2: Grant to super_admin (view + edit; no create/delete)
-- ============================================================

-- 2. Grant to super_admin (idempotent via unique (role, permission_key)).
--    Uses DO NOTHING (not DO UPDATE SET actions = EXCLUDED.actions) because:
--      a) super_admin bypasses withPermission() in src/lib/auth/middleware.ts —
--         this grant is a defensive belt-and-suspenders, not load-bearing.
--      b) A re-run must NOT silently undo a deliberate revocation made by an
--         RBAC admin via the UI after first apply. Matches migration 369.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES (
  'super_admin',
  'procurement.field-stock.force-correct',
  '{"view": true, "create": false, "edit": true, "delete": false}'::jsonb
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ============================================================
-- SECTION 3: Record migration
-- ============================================================

INSERT INTO migrations (version, name, executed_at)
VALUES ('378', 'rbac_field_stock_force_correct', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================
-- ROLLBACK (manual — not auto-applied):
-- BEGIN;
-- DELETE FROM role_permissions WHERE permission_key = 'procurement.field-stock.force-correct';
-- DELETE FROM access_permissions WHERE key = 'procurement.field-stock.force-correct';
-- DELETE FROM migrations WHERE version = '378';
-- COMMIT;
-- ============================================================
