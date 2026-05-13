-- Migration 346: Works QA — unassigned photo bucket
--
-- Adds a TEXT[] column on pole_qa_photos for photos that are linked to the
-- pole but not yet assigned to a specific checklist slot. Two sources fill it:
--   1. Historical construction_qa_photos rows where checklist_step IS NULL or 0
--      (the VLM marked them "Uncategorized"/"Unrelated"). Pulled in by
--      sync-historical.
--   2. The user dragging a photo OUT of a slot via the move-photo endpoint
--      — that photo goes back to the bucket for re-categorisation.

ALTER TABLE pole_qa_photos
  ADD COLUMN IF NOT EXISTS unassigned_photo_keys TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

-- Report
SELECT
  COUNT(*) FILTER (WHERE unassigned_photo_keys IS NOT NULL) AS rows_with_column,
  COUNT(*) FILTER (WHERE cardinality(unassigned_photo_keys) > 0) AS rows_with_unassigned_photos
FROM pole_qa_photos;
