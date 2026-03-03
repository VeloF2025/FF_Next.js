-- Migration 238: Add missing columns to field_ops_wa_photos
-- The photo service and VLM service reference updated_at, uploaded_at, and upload_error
-- but these were never added to the table in migration 228.

ALTER TABLE field_ops_wa_photos
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS upload_error TEXT;
