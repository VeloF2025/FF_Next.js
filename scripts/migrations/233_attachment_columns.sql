-- Migration 233: Add missing columns to maintenance_attachments
-- The attachmentService expects these columns but only file_url, file_type, file_size exist
-- Adds: mime_type, storage_path, storage_url, verification_step_id, is_evidence

ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS verification_step_id UUID;
ALTER TABLE maintenance_attachments ADD COLUMN IF NOT EXISTS is_evidence BOOLEAN DEFAULT false;

-- Make file_url nullable (service uses storage_url instead)
ALTER TABLE maintenance_attachments ALTER COLUMN file_url DROP NOT NULL;

-- Backfill storage_url from file_url for existing records
UPDATE maintenance_attachments SET storage_url = file_url WHERE storage_url IS NULL AND file_url IS NOT NULL;
UPDATE maintenance_attachments SET storage_path = file_url WHERE storage_path IS NULL AND file_url IS NOT NULL;

-- Fix trigger function that still referenced old 'tickets' table name
CREATE OR REPLACE FUNCTION increment_attachments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE maintenance_tickets SET attachments_count = attachments_count + 1 WHERE id = NEW.ticket_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE maintenance_tickets SET attachments_count = GREATEST(attachments_count - 1, 0) WHERE id = OLD.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
