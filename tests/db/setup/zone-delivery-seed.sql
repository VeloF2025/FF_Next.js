-- Minimal production-shaped dependencies for migration 470.
-- Loaded only by tests/db/setup/global-setup.ts into the Docker test database.

BEGIN;

CREATE TABLE pon_stage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER NOT NULL,
  pon_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, zone_no, pon_no)
);

INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no)
VALUES (
  '47000000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  1,
  1
);

CREATE TABLE snags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  snag_number INTEGER NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO snags (id, project_id, snag_number, category, description)
VALUES (
  '47000000-0000-4000-8000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  1,
  'verification',
  'Docker fixture snag'
);

CREATE TABLE access_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('module', 'page', 'tab', 'action')),
  key VARCHAR(100) UNIQUE NOT NULL,
  parent_key VARCHAR(100),
  label VARCHAR(100) NOT NULL,
  description TEXT,
  route VARCHAR(200),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO access_permissions (
  type, key, parent_key, label, route, sort_order
) VALUES (
  'page',
  'construction-qa.qa-centre',
  'construction-qa',
  'QA Centre',
  '/field-ops',
  1
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL,
  permission_key VARCHAR(100) NOT NULL
    REFERENCES access_permissions(key) ON DELETE CASCADE,
  actions JSONB NOT NULL DEFAULT
    '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role, permission_key)
);

CREATE TABLE user_permission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  permission_key VARCHAR(100) NOT NULL
    REFERENCES access_permissions(key) ON DELETE CASCADE,
  override_type VARCHAR(10) NOT NULL
    CHECK (override_type IN ('grant', 'revoke')),
  actions JSONB NOT NULL,
  granted_by UUID,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  reason TEXT,
  UNIQUE (user_id, permission_key)
);

CREATE TABLE schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
