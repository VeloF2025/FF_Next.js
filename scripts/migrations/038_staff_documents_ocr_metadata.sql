-- Migration: 038_staff_documents_ocr_metadata.sql
-- Purpose: Add OCR metadata column to staff_documents for storing extracted data before verification
-- Created: 2026-01-13

-- Add ocr_metadata JSONB column to store OCR-extracted fields
ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS ocr_metadata JSONB DEFAULT '{}'::jsonb;

-- Comment for documentation
COMMENT ON COLUMN staff_documents.ocr_metadata IS 'Stores OCR-extracted fields from document upload. Data synced to staff table only upon document verification.';

-- Index for querying documents with specific OCR data
CREATE INDEX IF NOT EXISTS idx_staff_documents_ocr_metadata ON staff_documents USING gin(ocr_metadata);
