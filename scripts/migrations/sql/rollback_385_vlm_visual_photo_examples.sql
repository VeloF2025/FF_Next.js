-- Rollback for migration 385: VLM Visual Photo Examples
DROP INDEX IF EXISTS idx_vlm_visual_examples_step;
DROP TABLE IF EXISTS vlm_visual_photo_examples;
