-- Migration 370: Works QA — rewrite broken unassigned_photo_keys to resolvable paths
--
-- Background:
-- Johan reported "corrupted" photo thumbnails in the unassigned bucket on
-- 2026-05-22 (post-PR-#1721 rollout). Forensic investigation showed photos
-- are NOT deleted — they exist in MinIO but at a different qfield project
-- path than what pole_qa_photos.unassigned_photo_keys references.
--
-- Concrete example (MOA.P.A830):
--   DB key (broken):
--     projects/bec5f353-2e83-4f6b-989a-fca83ad94e16/files/DCIM/JPEG_20251021135154628.jpg
--   Actual blob:
--     projects/137eb5ec-4c0b-4eab-8a5c-de046eb06349/files/DCIM/JPEG_20251021135154628.jpg/v20251107045030-baba3b9a
--
-- Root cause: On 2026-03-13 a QField re-sync wrote pole_qa_photos rows with
-- a NEW qfield project id (bec5f353 / FT_Mohadin) for photos that were
-- originally uploaded under an OLDER project (137eb5ec / MOA Pole Audit).
-- The older project still has the blobs; the newer paths never materialised.
-- qfield_photo_validations has BOTH rows for the same logical photo — the
-- older (2026-02-07) row with the resolvable path and the newer (2026-03-13)
-- row with the broken path.
--
-- Scope (verified 2026-05-22):
--   492 poles affected
--   1093 broken qfield keys total
--   486 recoverable via qfield_photo_validations filename lookup
--   607 have no resolvable alternative (genuinely missing OR matchable in a way
--       this query doesn't catch — out of scope here)
--
-- Strategy:
--   1. Build a temp lookup of broken-key → resolvable-key using the longest
--      common "/files/<logical_path>" tail.
--   2. For each affected pole, rebuild unassigned_photo_keys with rewrites
--      applied (preserving array order via WITH ORDINALITY).
--   3. Log audit rows so we can reverse the rewrites if anything goes wrong.

BEGIN;

-- Audit table preserves the before-state so a rollback is mechanical.
CREATE TABLE IF NOT EXISTS works_qa_photo_key_rewrites_2026_05_22 (
  id SERIAL PRIMARY KEY,
  pole_id UUID NOT NULL,
  pole_label TEXT NOT NULL,
  broken_key TEXT NOT NULL,
  resolvable_key TEXT NOT NULL,
  rewritten_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clear any leftover rows from a prior aborted attempt. Without this, the
-- next-line INSERT accumulates: each retry adds another 486 rows to the
-- audit table, doubling the count seen by the safety guard below
-- (486 → 972 → "more rewrites than expected") and re-blocking the migration.
-- Observed on production 2026-05-22 (PR #1740 deploy): the runner had failed
-- once leaving 486 rows behind; the rerun's INSERT produced 972 → guard tripped.
TRUNCATE works_qa_photo_key_rewrites_2026_05_22;

-- Identify rewrites
WITH broken AS (
  SELECT p.id AS pole_id, p.pole_label, k AS broken_key,
         regexp_replace(k, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\1') AS logical_path
  FROM pole_qa_photos p, unnest(p.unassigned_photo_keys) AS k
  WHERE k LIKE 'projects/%' AND k !~ '/v[0-9]{14}-[a-f0-9]+$'
),
versioned AS (
  SELECT DISTINCT ON (logical_path)
         photo_key,
         regexp_replace(photo_key, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\1') AS logical_path
  FROM qfield_photo_validations
  WHERE photo_key ~ '/v[0-9]{14}-[a-f0-9]+$'
  ORDER BY logical_path, validated_at DESC
)
INSERT INTO works_qa_photo_key_rewrites_2026_05_22 (pole_id, pole_label, broken_key, resolvable_key)
SELECT b.pole_id, b.pole_label, b.broken_key, v.photo_key
FROM broken b
JOIN versioned v USING (logical_path);

-- Sanity check: log the count
DO $$
DECLARE rewrite_count INT;
BEGIN
  SELECT count(*) INTO rewrite_count FROM works_qa_photo_key_rewrites_2026_05_22;
  RAISE NOTICE 'Identified % rewrites (expected ~486)', rewrite_count;
  IF rewrite_count < 1 THEN
    RAISE EXCEPTION 'No rewrites identified — aborting';
  END IF;
  IF rewrite_count > 800 THEN
    RAISE EXCEPTION 'More rewrites than expected (% > 800) — aborting for safety', rewrite_count;
  END IF;
END $$;

-- Apply rewrites preserving array order
UPDATE pole_qa_photos p
SET unassigned_photo_keys = (
  SELECT array_agg(COALESCE(r.resolvable_key, u.k) ORDER BY u.ord)
  FROM unnest(p.unassigned_photo_keys) WITH ORDINALITY AS u(k, ord)
  LEFT JOIN works_qa_photo_key_rewrites_2026_05_22 r
    ON r.pole_id = p.id AND r.broken_key = u.k
),
updated_at = NOW()
WHERE id IN (SELECT pole_id FROM works_qa_photo_key_rewrites_2026_05_22);

-- Post-condition: zero rewritten broken keys should remain in any unassigned_photo_keys
DO $$
DECLARE residual INT;
BEGIN
  SELECT count(*) INTO residual
  FROM works_qa_photo_key_rewrites_2026_05_22 r
  JOIN pole_qa_photos p ON p.id = r.pole_id
  WHERE r.broken_key = ANY(p.unassigned_photo_keys);

  IF residual > 0 THEN
    RAISE EXCEPTION 'Post-condition failed: % broken keys still present after rewrite', residual;
  END IF;
END $$;

INSERT INTO migrations (version, name, executed_at)
VALUES ('370', 'works_qa_rewrite_broken_photo_keys', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
