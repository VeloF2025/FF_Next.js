-- Migration 422: add perceptual-hash column to vlm_visual_photo_examples
-- Purpose: enable nearest-example (relevance) selection of gallery few-shot
--          examples instead of newest-first. Stores a 64-bit dHash (16 hex
--          chars) per curated example; loadGalleryExamples ranks candidates by
--          Hamming distance to the photo under judgement.
--
-- Safe / additive: nullable column, no data rewrite. Rows without a phash fall
-- back to recency ordering, so the app behaves exactly as before until the
-- backfill (scripts/sitecam/backfill-gallery-phash.ts) has populated it.
-- Idempotent.

ALTER TABLE vlm_visual_photo_examples
  ADD COLUMN IF NOT EXISTS phash text;

COMMENT ON COLUMN vlm_visual_photo_examples.phash IS
  'Perceptual dHash (16 hex chars / 64 bits) for relevance-based few-shot selection. NULL = not yet computed (falls back to recency).';
