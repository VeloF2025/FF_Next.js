-- Migration 258: Photo content hashes for cross-DR duplicate detection
-- Stores SHA-256 hashes of every photo. When a human marks a photo as
-- "Duplicate Photo" (step -1), the hash is flagged so future DRs with
-- the same photo are automatically detected.

CREATE TABLE IF NOT EXISTS photo_content_hashes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  drop_number VARCHAR(20) NOT NULL,
  filename TEXT NOT NULL,
  sha256_hash VARCHAR(64) NOT NULL,
  marked_duplicate_by TEXT,
  marked_duplicate_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pch_hash ON photo_content_hashes(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_pch_drop ON photo_content_hashes(drop_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pch_drop_file ON photo_content_hashes(drop_number, filename);

COMMENT ON TABLE photo_content_hashes IS 'SHA-256 hashes of DR photos for cross-DR duplicate detection';
COMMENT ON COLUMN photo_content_hashes.sha256_hash IS 'SHA-256 hex digest of photo file content';
COMMENT ON COLUMN photo_content_hashes.marked_duplicate_by IS 'User ID who marked this photo as duplicate (step -1), NULL if not marked';
COMMENT ON COLUMN photo_content_hashes.marked_duplicate_at IS 'When the photo was marked as duplicate';
