-- Migration 241: Add is_required flag to pipeline documents
-- Allows users to mark documents as required/compulsory so they appear
-- in a dedicated "Required Documents" section on the project detail page.

ALTER TABLE pipeline_approval_documents
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false;

-- Index for quick filtering of required documents per project
CREATE INDEX IF NOT EXISTS idx_pipeline_docs_required
  ON pipeline_approval_documents (pipeline_project_id, is_required)
  WHERE is_active = true;

COMMENT ON COLUMN pipeline_approval_documents.is_required IS
  'When true, document appears in the Required Documents section of the pipeline project detail page';
