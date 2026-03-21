-- =====================================================
-- Migration 249: Conduit Module
-- Creates conduit_projects + conduit_project_versions tables
-- and grants RBAC access to Hein, Lew, Hanro.
-- =====================================================

BEGIN;

-- -------------------------------------------------------
-- 1. conduit_projects — one row per project scenario
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS conduit_projects (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text        NOT NULL,
  po_count               integer     NOT NULL DEFAULT 0,
  start_date             date,
  build_duration_months  integer     NOT NULL DEFAULT 12,
  inputs_json            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_baseline_locked     boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_conduit_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conduit_projects_updated_at ON conduit_projects;
CREATE TRIGGER trg_conduit_projects_updated_at
  BEFORE UPDATE ON conduit_projects
  FOR EACH ROW EXECUTE FUNCTION update_conduit_projects_updated_at();

-- -------------------------------------------------------
-- 2. conduit_project_versions — version history snapshots
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS conduit_project_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES conduit_projects(id) ON DELETE CASCADE,
  version_label   text        NOT NULL,
  inputs_snapshot jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conduit_project_versions_project_id
  ON conduit_project_versions(project_id);

-- -------------------------------------------------------
-- 3. RBAC permissions
-- -------------------------------------------------------
INSERT INTO access_permissions (type, key, label, description, sort_order, is_active)
VALUES ('module', 'conduit', 'Conduit', 'Conduit — project scenario modelling', 25, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO access_permissions (type, key, parent_key, label, description, sort_order, is_active)
VALUES ('tab', 'conduit.main', 'conduit', 'Portfolio', 'Conduit portfolio table', 1, true)
ON CONFLICT (key) DO NOTHING;

-- Grant Hein (28ab98c1-df21-48f8-a30a-489cd09a0d39)
INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, granted_by, granted_at, reason)
VALUES (
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', 'conduit', 'grant',
  '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', NOW(), 'Conduit module access'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  override_type = 'grant',
  actions = '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb,
  granted_at = NOW();

-- Grant Lew (7d84184b-2a2b-4fbb-a52e-9815d0e92237)
INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, granted_by, granted_at, reason)
VALUES (
  '7d84184b-2a2b-4fbb-a52e-9815d0e92237', 'conduit', 'grant',
  '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', NOW(), 'Conduit module access'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  override_type = 'grant',
  actions = '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb,
  granted_at = NOW();

-- Grant Hanro (dfb080fa-5052-4603-a9ae-b396982883a7)
INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, granted_by, granted_at, reason)
VALUES (
  'dfb080fa-5052-4603-a9ae-b396982883a7', 'conduit', 'grant',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  '28ab98c1-df21-48f8-a30a-489cd09a0d39', NOW(), 'Conduit module read access'
)
ON CONFLICT (user_id, permission_key) DO UPDATE SET
  override_type = 'grant',
  actions = '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  granted_at = NOW();

-- -------------------------------------------------------
-- 4. Seed Lawley defaults
-- -------------------------------------------------------
INSERT INTO conduit_projects (
  id, name, po_count, start_date, build_duration_months, inputs_json
) VALUES (
  'a1b2c3d4-0000-4000-8000-000000000001',
  'Lawley',
  15111,
  '2025-01-01',
  16,
  '{
    "rate": 2700,
    "uptake": 0.60,
    "scope": {
      "poles": 4471,
      "stringing_m": 110000,
      "pon": 159
    },
    "service_rates": {
      "permissions_per_pole": 10,
      "poles_each": 600,
      "stringing_per_m": 10,
      "optical_per_pon": 9000,
      "activation_each": 155
    },
    "stock_rates": {
      "pole": 993.19,
      "cable_per_m": 11.73,
      "optical": 4422.61,
      "activation": 191.68
    },
    "expenses_per_month": {
      "ad_hoc": 168021,
      "casuals": 488480,
      "fuel": 350993,
      "overheads": 2996992,
      "sales": 0
    }
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
