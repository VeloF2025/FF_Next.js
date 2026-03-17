-- Migration: 244_dedup_construction_qa_photos.sql
-- Description: Remove duplicate photos from construction_qa_photos and add
--              unique constraint on (review_id, filename) to prevent future dupes.
--              Root cause: ingestion NOT EXISTS check didn't match local-copied photos.
-- Date: 2026-03-17

-- ============================================================================
-- Step 1: Remove duplicates, keeping the earliest row per (review_id, filename)
-- ============================================================================

DELETE FROM construction_qa_photos
WHERE id NOT IN (
  SELECT DISTINCT ON (review_id, filename)
    id
  FROM construction_qa_photos
  ORDER BY review_id, filename, created_at ASC
);

-- ============================================================================
-- Step 2: Add unique constraint to prevent future duplicates
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_cqa_photos_review_filename_uniq
  ON construction_qa_photos(review_id, filename);

-- ============================================================================
-- Step 3: Update photo_count on reviews to reflect actual counts after dedup
-- ============================================================================

UPDATE construction_qa_reviews r
SET photo_count = (
  SELECT COUNT(*)::int
  FROM construction_qa_photos p
  WHERE p.review_id = r.id
),
updated_at = NOW();

-- ============================================================================
-- Step 4: Update source CHECK constraint to include 'local' (photos copied to
--         local storage from MinIO are stored with source='local')
-- ============================================================================

ALTER TABLE construction_qa_photos DROP CONSTRAINT IF EXISTS construction_qa_photos_source_check;
ALTER TABLE construction_qa_photos
  ADD CONSTRAINT construction_qa_photos_source_check
  CHECK (source IN ('qfield', 'sharepoint', 'whatsapp', 'upload', 'local'));
