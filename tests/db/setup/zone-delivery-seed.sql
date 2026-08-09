-- Minimal production-shaped dependencies for migration 470.
-- Loaded only by tests/db/setup/global-setup.ts into the Docker test database.

BEGIN;

INSERT INTO projects (id, project_name) VALUES
  ('11111111-1111-1111-1111-111111111112', 'Test Project B');

CREATE TABLE pon_stage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER NOT NULL,
  pon_no INTEGER NOT NULL,
  -- Prod defaults these to '1map'/NOW() because the 1Map sync is its only
  -- writer. ensureCanonicalPons stamps 'works-qa' and leaves last_synced_at
  -- NULL, so both columns must exist here or the insert fails at runtime.
  -- Note the provenance is not durable: the 1Map sync's DO UPDATE restamps
  -- sync_source to '1map' for any row it later covers.
  sync_source VARCHAR DEFAULT '1map',
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  overall_stage VARCHAR DEFAULT 'not_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, zone_no, pon_no)
);

-- The PON list Works QA renders, which ensureCanonicalPons reads to create the
-- canonical rows a zone command needs.
--
-- Prod's v_pole_planning (migration 472) is NOT sow_poles alone — it is a FULL
-- JOIN of deduplicated sow_poles over public.poles, and sow_poles covers only
-- Mohadin/Lawley/Mamelodi. Every other project reaches the view through
-- public.poles. Modelling only the sow_poles arm here would exercise the branch
-- feeding the three projects that already had canonical rows and never the one
-- feeding the eight that did not — the tests would pass without touching the
-- case they exist for. Both arms are therefore present.
CREATE TABLE sow_poles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER,
  pon_no INTEGER,
  pole_number TEXT
);

CREATE TABLE poles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER,
  pon_no INTEGER,
  pole_number TEXT,
  UNIQUE (project_id, pole_number)
);

CREATE VIEW v_pole_planning AS
  SELECT
    COALESCE(sow.project_id, gpkg.project_id)   AS project_id,
    COALESCE(sow.pole_number, gpkg.pole_number) AS pole_number,
    COALESCE(sow.zone_no, gpkg.zone_no)         AS zone_no,
    COALESCE(sow.pon_no, gpkg.pon_no)           AS pon_no
  FROM (
    SELECT project_id, pole_number, MIN(zone_no) AS zone_no, MIN(pon_no) AS pon_no
    FROM sow_poles GROUP BY project_id, pole_number
  ) sow
  FULL JOIN poles gpkg
    ON gpkg.project_id = sow.project_id AND gpkg.pole_number = sow.pole_number;

CREATE TABLE pole_qa_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no INTEGER,
  pon_no INTEGER,
  pole_label TEXT,
  approved_at TIMESTAMPTZ
);

-- Zone 9 of Test Project A reaches Works QA through the sow_poles arm, plus a
-- PON known only to pole_qa_photos. No pon_stage_tracking row, no delivery
-- state, no approved scope.
INSERT INTO sow_poles (project_id, zone_no, pon_no, pole_number) VALUES
  ('11111111-1111-1111-1111-111111111111', 9, 91, 'P-91-A'),
  ('11111111-1111-1111-1111-111111111111', 9, 92, 'P-92-A');

INSERT INTO pole_qa_photos (project_id, zone_no, pon_no, pole_label) VALUES
  ('11111111-1111-1111-1111-111111111111', 9, 92, 'P-92-A'),
  ('11111111-1111-1111-1111-111111111111', 9, 93, 'P-93-A');

-- Zone 8 reaches Works QA ONLY through public.poles — the arm that carries the
-- eight projects sow_poles does not cover.
INSERT INTO poles (project_id, zone_no, pon_no, pole_number) VALUES
  ('11111111-1111-1111-1111-111111111111', 8, 81, 'P-81-A'),
  ('11111111-1111-1111-1111-111111111111', 8, 82, 'P-82-A');

-- Activations behind the tracker's "homes active". Prod's oes_activations is
-- UNIQUE on drop_number — one current row per drop, not an event log — so the
-- tracker counts rows directly rather than reducing to a latest event.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS zone_no INTEGER;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS pon_no INTEGER;

CREATE TABLE oes_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT UNIQUE NOT NULL,
  drop_id UUID REFERENCES drops(id),
  status TEXT
);

INSERT INTO drops (drop_number, project_id, zone_no, pon_no) VALUES
  ('DR-Z9-P91-1', '11111111-1111-1111-1111-111111111111', 9, 91),
  ('DR-Z9-P91-2', '11111111-1111-1111-1111-111111111111', 9, 91),
  ('DR-Z9-P92-1', '11111111-1111-1111-1111-111111111111', 9, 92),
  ('DR-Z8-P81-1', '11111111-1111-1111-1111-111111111111', 8, 81);

-- PON 91 has two live homes, PON 92 has one uninstalled (so it is NOT live),
-- PON 93 has none at all, and zone 8's PON 81 has one.
INSERT INTO oes_activations (drop_number, drop_id, status)
SELECT d.drop_number, d.id,
  CASE WHEN d.drop_number = 'DR-Z9-P92-1' THEN 'Uninstalled' ELSE 'Active' END
FROM drops d WHERE d.drop_number LIKE 'DR-Z%';

INSERT INTO pon_stage_tracking (id, project_id, zone_no, pon_no) VALUES
  (
    '47000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    1,
    1
  ),
  (
    '47000000-0000-4000-8000-000000000003',
    '11111111-1111-1111-1111-111111111112',
    2,
    1
  );

CREATE TABLE construction_qa_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  discipline TEXT NOT NULL CHECK (discipline IN ('civil', 'optical')),
  feature_type TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  zone_no INTEGER,
  pon_no INTEGER,
  workflow_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE snags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  snag_number INTEGER NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO snags (id, project_id, snag_number, category, description) VALUES
  (
    '47000000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    1,
    'verification',
    'Docker fixture snag'
  ),
  (
    '47000000-0000-4000-8000-000000000004',
    '11111111-1111-1111-1111-111111111112',
    2,
    'verification',
    'Foreign Docker fixture snag'
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
