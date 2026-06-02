-- Migration 391: add job_type column to vlm_visual_photo_examples
-- Purpose: extend VLM example storage to support civils steps (1-8)
--          in addition to existing activation steps (1-12)
-- Safe to re-run: all DDL drops constraints before re-adding them.

-- 1. Add job_type column; existing activation rows default to 'activation'
ALTER TABLE vlm_visual_photo_examples
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'activation';

-- 2. Drop the old step_number range constraint (only allowed 1-12)
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_step_number_check;

-- 3. Replace with a constraint that covers both activation (1-12) and civils (1-8).
--    DROP-then-ADD because Postgres has no ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_step_check;
ALTER TABLE vlm_visual_photo_examples
  ADD CONSTRAINT vlm_visual_photo_examples_step_check CHECK (
    (job_type = 'activation' AND step_number >= 1 AND step_number <= 12)
    OR
    (job_type = 'civils'     AND step_number >= 1 AND step_number <= 8)
  );

-- 4. Constrain job_type to the known vocabulary
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_job_type_check;
ALTER TABLE vlm_visual_photo_examples
  ADD CONSTRAINT vlm_visual_photo_examples_job_type_check
    CHECK (job_type IN ('activation', 'civils'));

-- 5. Index for civils gallery queries
CREATE INDEX IF NOT EXISTS idx_vlm_visual_examples_job_step
  ON vlm_visual_photo_examples (job_type, step_number, label);
