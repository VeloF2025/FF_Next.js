-- Migration 242: Snags Module
-- Creates tables for TQR audit report tracking: snag_reports, snags, snag_photos
-- Adds RBAC permissions for construction-qa.snags

-- ============================================================
-- Table: snag_reports
-- Weekly TQR audit report container
-- ============================================================
CREATE TABLE IF NOT EXISTS snag_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id),
  report_number         TEXT NOT NULL,
  site_name             TEXT,
  client                TEXT DEFAULT 'Fibertime',
  contractor            TEXT DEFAULT 'Velocity Fibre',
  audit_date            DATE NOT NULL,
  auditor               TEXT,
  source_pdf_url        TEXT,
  source_pdf_filename   TEXT,

  -- Audit scores (from Quality Audit Results chart)
  quality_assurance     INTEGER DEFAULT 0,
  quality_nc            INTEGER DEFAULT 0,
  health_assurance      INTEGER DEFAULT 0,
  health_nc             INTEGER DEFAULT 0,
  safety_assurance      INTEGER DEFAULT 0,
  safety_nc             INTEGER DEFAULT 0,
  environment_assurance INTEGER DEFAULT 0,
  environment_nc        INTEGER DEFAULT 0,
  traffic_assurance     INTEGER DEFAULT 0,
  traffic_nc            INTEGER DEFAULT 0,

  -- Metadata
  total_findings        INTEGER DEFAULT 0,
  import_status         TEXT DEFAULT 'pending',
  import_notes          TEXT,
  imported_by           UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(report_number)
);

-- ============================================================
-- Table: snags
-- Individual findings from TQR reports
-- ============================================================
CREATE TABLE IF NOT EXISTS snags (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES snag_reports(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id),
  snag_number       INTEGER NOT NULL,

  -- Classification
  category          TEXT NOT NULL,
  severity          TEXT DEFAULT 'major',
  description       TEXT NOT NULL,

  -- Location linkage
  pole_references   TEXT[],
  pole_ids          UUID[],
  zone_id           UUID,                           -- No FK: zones not a standalone table yet
  pon_id            UUID,
  drop_id           UUID,

  -- Lifecycle
  status            TEXT DEFAULT 'open',
  noc_ticket_id     UUID,
  assigned_to       UUID REFERENCES users(id),
  assigned_at       TIMESTAMPTZ,
  fix_deadline      TIMESTAMPTZ,
  fixed_at          TIMESTAMPTZ,
  fixed_by          UUID REFERENCES users(id),
  verified_at       TIMESTAMPTZ,
  verified_by       UUID REFERENCES users(id),
  verification_notes TEXT,
  closed_at         TIMESTAMPTZ,

  -- Repeat tracking
  is_repeat         BOOLEAN DEFAULT FALSE,
  repeat_of_snag_id UUID REFERENCES snags(id),
  repeat_count      INTEGER DEFAULT 0,
  reopen_count      INTEGER DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(report_id, snag_number)
);

-- ============================================================
-- Table: snag_photos
-- Photo evidence for each snag (before/during/after)
-- ============================================================
CREATE TABLE IF NOT EXISTS snag_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snag_id         UUID NOT NULL REFERENCES snags(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL,
  photo_url       TEXT NOT NULL,
  thumbnail_url   TEXT,
  pole_reference  TEXT,
  caption         TEXT,
  source          TEXT NOT NULL,
  vlm_assessment  JSONB,

  uploaded_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(snag_id, phase, photo_url)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_snags_project_status ON snags(project_id, status);
CREATE INDEX IF NOT EXISTS idx_snags_report ON snags(report_id);
CREATE INDEX IF NOT EXISTS idx_snags_noc_ticket ON snags(noc_ticket_id);
CREATE INDEX IF NOT EXISTS idx_snags_category ON snags(category);
CREATE INDEX IF NOT EXISTS idx_snag_photos_snag ON snag_photos(snag_id);
CREATE INDEX IF NOT EXISTS idx_snag_reports_project ON snag_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_snag_reports_audit_date ON snag_reports(audit_date);

-- ============================================================
-- RBAC: Register snags permissions in access_permissions
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
  ('page', 'construction-qa.snags',               'construction-qa', 'Snags',               '/field-ops/snags',  3),
  ('page', 'construction-qa.snags.import',         'construction-qa', 'Snags Import',        '/field-ops/snags',  4),
  ('page', 'construction-qa.snags.manage',         'construction-qa', 'Snags Manage',        '/field-ops/snags',  5),
  ('page', 'construction-qa.snags.verify',         'construction-qa', 'Snags Verify',        '/field-ops/snags',  6),
  ('page', 'construction-qa.snags.create-ticket',  'construction-qa', 'Snags Create Ticket', '/field-ops/snags',  7),
  ('page', 'construction-qa.snags.reports',        'construction-qa', 'Snags Reports',       '/field-ops/snags',  8)
ON CONFLICT (key) DO NOTHING;

-- Grant super_admin full access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
  'construction-qa.snags',
  'construction-qa.snags.import',
  'construction-qa.snags.manage',
  'construction-qa.snags.verify',
  'construction-qa.snags.create-ticket',
  'construction-qa.snags.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Grant admin full access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
  'construction-qa.snags',
  'construction-qa.snags.import',
  'construction-qa.snags.manage',
  'construction-qa.snags.verify',
  'construction-qa.snags.create-ticket',
  'construction-qa.snags.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Grant project_manager view + manage + create-ticket + reports
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'project_manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
  'construction-qa.snags',
  'construction-qa.snags.manage',
  'construction-qa.snags.create-ticket',
  'construction-qa.snags.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Grant qa_manager full access to all snag permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'qa_manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
  'construction-qa.snags',
  'construction-qa.snags.import',
  'construction-qa.snags.manage',
  'construction-qa.snags.verify',
  'construction-qa.snags.create-ticket',
  'construction-qa.snags.reports'
)
ON CONFLICT (role, permission_key) DO NOTHING;
