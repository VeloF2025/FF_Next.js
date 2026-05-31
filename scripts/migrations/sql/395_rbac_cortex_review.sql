-- Migration 395: RBAC — Provision cortex.review permission
-- Adds the cortex.review module permission + action sub-permissions
-- for the Cortex Meeting Reviewer UI (Goal 2 / Phase 2.1c UI).
--
-- Permission model (per spec §4.3):
--   cortex.review           — module-level view gate (all roles that can see the panel)
--   cortex.review:edit      — approve/reject/edit proposed actions + Publish (manager+)
--   cortex.review:delete    — Re-open/unpublish (admin+)
--
-- We use the existing access_permissions + role_permissions tables; no schema changes.

BEGIN;

-- ── 1. access_permissions rows ────────────────────────────────────────────────

INSERT INTO access_permissions (type, key, label, description, sort_order)
VALUES
  ('module', 'cortex',        'Cortex', 'Cortex AI platform features', 90),
  ('page',   'cortex.review', 'Meeting Reviewer',
   'Review and publish Cortex Scribe proposed meeting actions', 1)
ON CONFLICT (key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- Wire the parent so the cascade logic in getUserEffectivePermissions works
UPDATE access_permissions
SET    parent_key = 'cortex'
WHERE  key = 'cortex.review'
  AND  parent_key IS NULL;

-- ── 2. role_permissions ───────────────────────────────────────────────────────

-- super_admin: everything (cascade from their blanket grant covers it, but be
-- explicit so the admin UI shows the row)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'cortex',        '{"view":true,"create":true,"edit":true,"delete":true}'::jsonb),
  ('super_admin', 'cortex.review', '{"view":true,"create":true,"edit":true,"delete":true}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE SET
  actions    = EXCLUDED.actions,
  updated_at = NOW();

-- admin: view + edit + delete (can re-open)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('admin', 'cortex',        '{"view":true,"create":true,"edit":true,"delete":true}'::jsonb),
  ('admin', 'cortex.review', '{"view":true,"create":true,"edit":true,"delete":true}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE SET
  actions    = EXCLUDED.actions,
  updated_at = NOW();

-- manager: view + edit (publish), NOT delete (no re-open)
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('manager', 'cortex',        '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb),
  ('manager', 'cortex.review', '{"view":true,"create":false,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO UPDATE SET
  actions    = EXCLUDED.actions,
  updated_at = NOW();

-- viewer / technician / storeman / contractor: no access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, p.key, '{"view":false,"create":false,"edit":false,"delete":false}'::jsonb
FROM (VALUES ('viewer'), ('technician'), ('storeman'), ('contractor')) AS r(role)
CROSS JOIN (
  SELECT key FROM access_permissions WHERE key IN ('cortex', 'cortex.review')
) AS p
ON CONFLICT (role, permission_key) DO NOTHING;

COMMIT;
