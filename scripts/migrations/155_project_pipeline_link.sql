-- Migration: 155_project_pipeline_link.sql
-- Description: Add bidirectional link between projects and pipeline_projects
-- Date: 2026-02-02

-- ============================================
-- 1. Add pipeline_project_id FK to projects table
-- ============================================

-- Add the column with FK reference
ALTER TABLE projects ADD COLUMN IF NOT EXISTS
  pipeline_project_id UUID REFERENCES pipeline_projects(id) ON DELETE SET NULL;

-- Add comment explaining the column
COMMENT ON COLUMN projects.pipeline_project_id IS 'Link to source pipeline project (if created via pipeline transition)';

-- ============================================
-- 2. Create index for efficient lookup
-- ============================================

-- Index for looking up projects by pipeline source
CREATE INDEX IF NOT EXISTS idx_projects_pipeline ON projects(pipeline_project_id)
  WHERE pipeline_project_id IS NOT NULL;

-- ============================================
-- 3. Backfill existing links
-- ============================================

-- Update projects that were created from pipeline_projects
-- (pipeline_projects.planned_project_id points to projects.id)
UPDATE projects p
SET pipeline_project_id = pp.id
FROM pipeline_projects pp
WHERE pp.planned_project_id = p.id
  AND p.pipeline_project_id IS NULL;

-- ============================================
-- 4. Success message
-- ============================================

SELECT 'Migration 155_project_pipeline_link completed - bidirectional link established' AS result;
