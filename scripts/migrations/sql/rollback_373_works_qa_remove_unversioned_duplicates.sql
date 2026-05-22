-- Rollback for migration 373: restore the unversioned-duplicate keys
--
-- Re-appends each removed_key to its pole's unassigned_photo_keys (order
-- relative to other restored entries is not preserved — they go to the end).

BEGIN;

UPDATE pole_qa_photos p
SET unassigned_photo_keys = COALESCE(p.unassigned_photo_keys, '{}'::text[]) || (
  SELECT array_agg(r.removed_key)
  FROM works_qa_dedup_removed_2026_05_22 r
  WHERE r.pole_id = p.id
    AND NOT (r.removed_key = ANY(COALESCE(p.unassigned_photo_keys, '{}'::text[])))
),
updated_at = NOW()
WHERE id IN (SELECT DISTINCT pole_id FROM works_qa_dedup_removed_2026_05_22);

DELETE FROM migrations WHERE version = '373';

COMMIT;
