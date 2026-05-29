-- Migration 389: RBAC — procurement.field-stock.block-holder
-- Adds a new action-type permission under 'procurement.field-stock' that
-- gates the block/unblock accountability endpoints (SOP 4.4). Two route
-- families both call withPermission('procurement.field-stock.block-holder', 'edit'):
--   holders/[holderId]/block + unblock     (pure-custody model, UI-wired,
--                                            writes stock_accountability.is_blocked
--                                            which backs the Track 4.1 issue guard)
--   [contractorId]/block + unblock          (legacy contractor_stock_accountability)
--
-- Granted to admin + manager (view + edit), matching the documented
-- "Manage accountability (block/unblock)" row in the help-centre permission
-- matrix (src/modules/help-center/data/manual-content.ts). super_admin is
-- seeded defensively (it bypasses withPermission() anyway). All other roles
-- receive an explicit all-false deny row so the cascade is unambiguous.
--
-- Mirrors the sibling action permission from migration 378
-- (procurement.field-stock.force-correct).
--
-- Idempotent: access_permissions uses ON CONFLICT (key) DO UPDATE; the
-- role grants use ON CONFLICT (role, permission_key) DO NOTHING so a re-run
-- never silently undoes a deliberate revocation made by an RBAC admin via the
-- UI after first apply (matches migrations 369 and 378).
--
-- RBAC parent-cascade caveat (see feedback_rbac_parent_override_cascade):
--   parent_key 'procurement.field-stock' is a page-type permission. admin and
--   manager both have it set to view:true (verified live), so the child grant
--   resolves. storeman also has the parent (view:true) but is intentionally
--   denied here — blocking a holder is an admin/manager action per SOP 4.4.

BEGIN;

-- ============================================================
-- SECTION 1: Register permission in the access_permissions catalogue
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order)
VALUES (
  'action',
  'procurement.field-stock.block-holder',
  'procurement.field-stock',
  'Block/unblock stock holder',
  'Block or unblock a stock holder (contractor) from receiving new stock (SOP 4.4). Writes a stock_accountability_history audit row.',
  101
)
ON CONFLICT (key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  parent_key  = EXCLUDED.parent_key;

-- ============================================================
-- SECTION 2: Role grants (admin + manager get view + edit; super_admin
--            defensively; every other role gets an explicit deny row)
-- ============================================================

INSERT INTO role_permissions (role, permission_key, actions) VALUES
  ('super_admin',     'procurement.field-stock.block-holder', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('admin',           'procurement.field-stock.block-holder', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('manager',         'procurement.field-stock.block-holder', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('project_manager', 'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('qa_manager',      'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('site_supervisor', 'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('storeman',        'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('technician',      'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('viewer',          'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('contractor',      'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb),
  ('client',          'procurement.field-stock.block-holder', '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ============================================================
-- SECTION 3: Record migration
-- ============================================================

INSERT INTO migrations (version, name, executed_at)
VALUES ('389', 'rbac_field_stock_block_holder', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================
-- ROLLBACK: scripts/migrations/sql/rollback_389_rbac_field_stock_block_holder.sql
-- ============================================================
