-- Migration 090: Add WhatsApp ID to staff table
-- Purpose: Store WhatsApp LID for @mention tagging in QA feedback
-- Date: 2026-01-19

-- Add whatsapp_id column to staff table
-- Stores WhatsApp LID (Linked Device ID) e.g., "10892708159649"
ALTER TABLE staff ADD COLUMN IF NOT EXISTS whatsapp_id VARCHAR(50);

-- Index for faster lookups when fetching staff with WhatsApp IDs
CREATE INDEX IF NOT EXISTS idx_staff_whatsapp_id ON staff(whatsapp_id) WHERE whatsapp_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN staff.whatsapp_id IS 'WhatsApp LID (Linked Device ID) for @mention tagging in QA feedback. Format: numeric string like 10892708159649';
