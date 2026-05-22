-- Rollback for migration 370: restore broken photo keys from audit table
--
-- Reverses every (broken_key → resolvable_key) rewrite by swapping
-- resolvable_key back to broken_key in unassigned_photo_keys.

BEGIN;

UPDATE pole_qa_photos p
SET unassigned_photo_keys = (
  SELECT array_agg(COALESCE(r.broken_key, u.k) ORDER BY u.ord)
  FROM unnest(p.unassigned_photo_keys) WITH ORDINALITY AS u(k, ord)
  LEFT JOIN works_qa_photo_key_rewrites_2026_05_22 r
    ON r.pole_id = p.id AND r.resolvable_key = u.k
),
updated_at = NOW()
WHERE id IN (SELECT pole_id FROM works_qa_photo_key_rewrites_2026_05_22);

-- Keep the audit table around for forensics — don't drop it on rollback.

DELETE FROM migrations WHERE version = '370';

COMMIT;
