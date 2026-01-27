-- Migration 134: QField Projects Management
-- Dynamic QField project mapping with optional FibreFlow project links
-- Replaces hardcoded env var NEXT_PUBLIC_QFIELD_PROJECT_ID

-- QField projects registry
CREATE TABLE IF NOT EXISTS qfield_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qfield_project_id VARCHAR(100) NOT NULL UNIQUE,  -- QFieldCloud project UUID
  name VARCHAR(255) NOT NULL,                       -- Display name
  description TEXT,
  qfield_url VARCHAR(500),                          -- Full QFieldCloud URL
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,                 -- Default project for OES sync
  sync_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Many-to-many link: QField project <-> FibreFlow projects
CREATE TABLE IF NOT EXISTS qfield_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qfield_project_id UUID NOT NULL REFERENCES qfield_projects(id) ON DELETE CASCADE,
  fibreflow_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(qfield_project_id, fibreflow_project_id)
);

CREATE INDEX IF NOT EXISTS idx_qfield_project_links_qfield ON qfield_project_links(qfield_project_id);
CREATE INDEX IF NOT EXISTS idx_qfield_project_links_ff ON qfield_project_links(fibreflow_project_id);

-- Seed existing test project
INSERT INTO qfield_projects (qfield_project_id, name, description, is_default, is_active, sync_enabled)
VALUES (
  'e849b878-f8a8-4f84-a3f1-9fbd051686c0',
  'Test Project (Automations)',
  'OES sync test project on QFieldCloud',
  true,
  true,
  true
)
ON CONFLICT (qfield_project_id) DO NOTHING;
