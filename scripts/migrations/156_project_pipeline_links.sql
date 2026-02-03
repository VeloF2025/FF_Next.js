-- Migration 156: Project Pipeline Links Junction Table
-- Enables one-to-many project ↔ pipeline relationships for multi-area projects
-- Created: 2026-02-03

-- Junction table for one-to-many project ↔ pipeline relationship
CREATE TABLE IF NOT EXISTS project_pipeline_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  link_type VARCHAR(50) DEFAULT 'manual',  -- 'transition' | 'manual'
  link_order INTEGER DEFAULT 0,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  linked_by UUID REFERENCES staff(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, pipeline_project_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_ppl_project ON project_pipeline_links(project_id);
CREATE INDEX IF NOT EXISTS idx_ppl_pipeline ON project_pipeline_links(pipeline_project_id);
CREATE INDEX IF NOT EXISTS idx_ppl_primary ON project_pipeline_links(project_id) WHERE is_primary = true;

-- Migrate existing one-to-one links from projects.pipeline_project_id
INSERT INTO project_pipeline_links (project_id, pipeline_project_id, is_primary, link_type, linked_at)
SELECT p.id, p.pipeline_project_id, true, 'transition', COALESCE(pp.transitioned_at, NOW())
FROM projects p
JOIN pipeline_projects pp ON p.pipeline_project_id = pp.id
WHERE p.pipeline_project_id IS NOT NULL
ON CONFLICT (project_id, pipeline_project_id) DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE project_pipeline_links IS 'Junction table enabling one-to-many project ↔ pipeline relationships. A project can be linked to multiple pipeline areas.';
COMMENT ON COLUMN project_pipeline_links.is_primary IS 'Primary link determines which pipeline''s wayleaves are shown by default';
COMMENT ON COLUMN project_pipeline_links.link_type IS 'How the link was created: transition (from pipeline) or manual (user linked)';
COMMENT ON COLUMN project_pipeline_links.link_order IS 'Display order for multiple links (0 = first)';
