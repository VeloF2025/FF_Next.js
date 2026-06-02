-- Rollback for migration 391: revert vlm_visual_photo_examples job_type changes.
-- Restores the original activation-only (1-12) step constraint and drops job_type.
-- NOTE: rows with job_type = 'civils' must be removed first or the restored
--       step_number check (1-12) may still hold but those rows lose their scope.

-- 1. Drop the index added in 391
DROP INDEX IF EXISTS idx_vlm_visual_examples_job_step;

-- 2. Drop the constraints added in 391
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_job_type_check;
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_step_check;

-- 3. Drop the job_type column
ALTER TABLE vlm_visual_photo_examples
  DROP COLUMN IF EXISTS job_type;

-- 4. Restore the original activation-only step range constraint
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT IF EXISTS vlm_visual_photo_examples_step_number_check;
ALTER TABLE vlm_visual_photo_examples
  ADD CONSTRAINT vlm_visual_photo_examples_step_number_check
    CHECK (step_number >= 1 AND step_number <= 12);
