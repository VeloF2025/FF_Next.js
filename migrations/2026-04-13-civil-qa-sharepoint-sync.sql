-- migrations/2026-04-13-civil-qa-sharepoint-sync.sql
-- Civil QA SharePoint sync tracking columns

ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS sp_sync_status  TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_synced_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_sync_error   TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_folder_url   TEXT       DEFAULT NULL;

-- Fast lookup for the batch worker: find all pending syncs
CREATE INDEX IF NOT EXISTS idx_cqa_sp_sync_status
  ON construction_qa_reviews (sp_sync_status)
  WHERE sp_sync_status IS NOT NULL;

COMMENT ON COLUMN construction_qa_reviews.sp_sync_status IS 'pending | syncing | synced | failed — null means not yet approved';
COMMENT ON COLUMN construction_qa_reviews.sp_synced_at   IS 'Timestamp of last successful SharePoint sync';
COMMENT ON COLUMN construction_qa_reviews.sp_sync_error  IS 'Last error message for failed syncs';
COMMENT ON COLUMN construction_qa_reviews.sp_folder_url  IS 'Direct SharePoint URL to the pole folder after sync';
