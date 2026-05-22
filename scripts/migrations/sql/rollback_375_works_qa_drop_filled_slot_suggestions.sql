-- Rollback for migration 375: restore the dropped suggestions
--
-- Re-adds each (photo_key, slot, confidence) entry back into the pole's
-- unassigned_suggestions JSONB. Uses NOW() for generated_at on restore
-- since we did not preserve the original timestamp.

BEGIN;

UPDATE pole_qa_photos p
SET unassigned_suggestions = (
  SELECT COALESCE(p.unassigned_suggestions, '{}'::jsonb) || jsonb_object_agg(
    d.photo_key,
    jsonb_build_object(
      'suggested_slot', d.suggested_slot,
      'confidence', d.confidence,
      'generated_at', NOW()
    )
  )
  FROM works_qa_dropped_suggestions_2026_05_22 d
  WHERE d.pole_id = p.id
),
updated_at = NOW()
WHERE id IN (SELECT DISTINCT pole_id FROM works_qa_dropped_suggestions_2026_05_22);

DELETE FROM migrations WHERE version = '375';

COMMIT;
