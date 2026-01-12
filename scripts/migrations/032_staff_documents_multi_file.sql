-- Staff Documents Multi-File Support Migration
-- Created: January 2026
-- Purpose: Add front/back file URL columns for documents like driver's license

-- ============================================
-- Add file_url_front and file_url_back columns
-- ============================================
-- These columns store separate URLs for multi-page documents
-- (e.g., driver's license front and back sides)

ALTER TABLE staff_documents
  ADD COLUMN IF NOT EXISTS file_url_front TEXT,
  ADD COLUMN IF NOT EXISTS file_url_back TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT NOW();

-- Add comments for documentation
COMMENT ON COLUMN staff_documents.file_url_front IS 'Front side file URL for documents like driver''s license';
COMMENT ON COLUMN staff_documents.file_url_back IS 'Back side file URL for documents like driver''s license';
COMMENT ON COLUMN staff_documents.file_path IS 'Storage path on VF Storage server';
COMMENT ON COLUMN staff_documents.file_name IS 'Original file name as uploaded';

-- ============================================
-- Usage Notes:
-- ============================================
-- For single-file documents:
--   - file_url contains the file URL
--   - file_url_front and file_url_back are NULL
--
-- For driver's license (multi-file):
--   - file_url contains the front file URL (for backwards compatibility)
--   - file_url_front contains the front side URL
--   - file_url_back contains the back side URL
