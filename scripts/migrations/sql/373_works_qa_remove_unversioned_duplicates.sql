-- Migration 373: remove unversioned-duplicate photo keys from unassigned buckets
--
-- After migrations 370 + 372 + the post-372 backfill, several poles ended up
-- with BOTH:
--   - the resolvable versioned path (eg projects/137eb5ec/.../JPEG_xxx.jpg/v...)
--   - the original broken unversioned path (eg projects/bec5f353/.../JPEG_xxx.jpg)
--
-- Cause: `backfill-works-qa-from-qfield.js` dedups by exact-string match. After
-- migration 370 rewrote keys to point at 137eb5ec, the bec5f353 strings were
-- no longer in unassigned_photo_keys, so when the backfill re-ran (after the
-- audit project got linked in migration 372) it saw the bec5f353 row in
-- qfield_photo_validations as "new" and added it back. Two thumbnails now
-- show for the same logical photo: one working, one broken.
--
-- This migration removes the unversioned duplicate when a versioned counterpart
-- exists for the same logical filename on the same pole's unassigned bucket.
-- Preserves array ordering. Idempotent.
--
-- Expected impact (verified 2026-05-22): 486 redundant unversioned keys removed
-- across ~190 poles.

BEGIN;

CREATE TABLE IF NOT EXISTS works_qa_dedup_removed_2026_05_22 (
  id SERIAL PRIMARY KEY,
  pole_id UUID NOT NULL,
  pole_label TEXT NOT NULL,
  removed_key TEXT NOT NULL,
  kept_key TEXT NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit the removals first so a rollback is mechanical
WITH unrolled AS (
  SELECT p.id AS pole_id, p.pole_label, k AS photo_key,
         regexp_replace(k, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\1') AS logical_path,
         k ~ '/v[0-9]{14}-[a-f0-9]+$' AS is_versioned
  FROM pole_qa_photos p, unnest(p.unassigned_photo_keys) AS k
  WHERE k LIKE 'projects/%'
)
INSERT INTO works_qa_dedup_removed_2026_05_22 (pole_id, pole_label, removed_key, kept_key)
SELECT u.pole_id, u.pole_label, u.photo_key,
       (SELECT u2.photo_key FROM unrolled u2
        WHERE u2.pole_id = u.pole_id AND u2.logical_path = u.logical_path AND u2.is_versioned
        ORDER BY u2.photo_key LIMIT 1) AS kept_key
FROM unrolled u
WHERE NOT u.is_versioned
  AND EXISTS (
    SELECT 1 FROM unrolled u2
    WHERE u2.pole_id = u.pole_id
      AND u2.logical_path = u.logical_path
      AND u2.is_versioned
  );

DO $$
DECLARE remove_count INT;
BEGIN
  SELECT count(*) INTO remove_count FROM works_qa_dedup_removed_2026_05_22;
  RAISE NOTICE 'Identified % unversioned-duplicate removals (expected ~486)', remove_count;
  IF remove_count < 1 THEN
    RAISE EXCEPTION 'No duplicates identified — aborting (nothing to do?)';
  END IF;
  IF remove_count > 1000 THEN
    RAISE EXCEPTION 'More duplicates than expected (% > 1000) — aborting for safety', remove_count;
  END IF;
END $$;

-- Apply: rebuild unassigned_photo_keys without the removed entries, preserving order
UPDATE pole_qa_photos p
SET unassigned_photo_keys = (
  SELECT array_agg(u.k ORDER BY u.ord)
  FROM unnest(p.unassigned_photo_keys) WITH ORDINALITY AS u(k, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM works_qa_dedup_removed_2026_05_22 r
    WHERE r.pole_id = p.id AND r.removed_key = u.k
  )
),
updated_at = NOW()
WHERE id IN (SELECT DISTINCT pole_id FROM works_qa_dedup_removed_2026_05_22);

-- Post-condition: no removed_key should remain in any unassigned_photo_keys
DO $$
DECLARE residual INT;
BEGIN
  SELECT count(*) INTO residual
  FROM works_qa_dedup_removed_2026_05_22 r
  JOIN pole_qa_photos p ON p.id = r.pole_id
  WHERE r.removed_key = ANY(p.unassigned_photo_keys);

  IF residual > 0 THEN
    RAISE EXCEPTION 'Post-condition failed: % duplicate keys still present after dedup', residual;
  END IF;
END $$;

INSERT INTO migrations (version, name, executed_at)
VALUES ('373', 'works_qa_remove_unversioned_duplicates', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
