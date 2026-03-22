-- Migration 230: Add onedrive_item_id to meetings for OneDrive recording scraper idempotency
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS onedrive_item_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_onedrive_item_id ON meetings (onedrive_item_id) WHERE onedrive_item_id IS NOT NULL;
