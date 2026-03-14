-- Migration 233: Add missing columns to maintenance_attachments
-- The attachmentService expects these columns but only file_url, file_type, file_size exist
-- Adds: mime_type, storage_path, storage_url, verification_step_id, is_evidence

ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS verification_step_id UUID;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS is_evidence BOOLEAN DEFAULT false;

-- Backfill storage_url from file_url for existing records
UPDATE maintenance_attachments SET storage_url = file_url WHERE storage_url IS NULL AND file_url IS NOT NULL;
UPDATE maintenance_attachments SET storage_path = file_url WHERE storage_path IS NULL AND file_url IS NOT NULL;
