-- Add checklist_step and step_label to qfield_photo_validations
-- so the GPKG extractor can store step assignments from GPKG columns
ALTER TABLE qfield_photo_validations
  ADD COLUMN IF NOT EXISTS checklist_step INTEGER,
  ADD COLUMN IF NOT EXISTS step_label TEXT;

-- Track which GPKG version was last processed per project
CREATE TABLE IF NOT EXISTS qfield_gpkg_sync_state (
  qf_project_id UUID NOT NULL,
  gpkg_path TEXT NOT NULL,
  last_version TEXT,
  last_synced_at TIMESTAMPTZ,
  row_count INTEGER,
  PRIMARY KEY (qf_project_id, gpkg_path)
);
