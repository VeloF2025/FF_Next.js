-- Migration 375: drop auto-sort suggestions whose target slot is filled
--
-- Johan WA 2026-05-22 15:08: "Die autosort maak bietjie probleme. Dit
-- overwrite fotos wat by die civil gelaai is." Cause: auto-sort writes
-- 'suggested' entries for high-confidence photos even when the target slot
-- is already filled. The Accept badge routes through move-photo whose swap
-- behavior REPLACES the slot's photo (pushing the manually-placed civil
-- photo back into the unassigned bucket). To the reviewer this looks like
-- auto-sort silently overwriting their work.
--
-- The same-PR code change in auto-sort.ts now classifies filled-slot photos
-- as 'leftover' instead of 'suggested'. This migration cleans the existing
-- prod data so no Accept badges currently render for filled-slot targets.
--
-- Strategy:
--   1. For every pending suggestion (photo_key → suggested_slot), check the
--      pole's corresponding slot column.
--   2. If the slot is NOT NULL, drop that suggestion entry from
--      unassigned_suggestions JSONB.
--   3. Audit kept in works_qa_dropped_suggestions_2026_05_22.

BEGIN;

CREATE TABLE IF NOT EXISTS works_qa_dropped_suggestions_2026_05_22 (
  id SERIAL PRIMARY KEY,
  pole_id UUID NOT NULL,
  pole_label TEXT NOT NULL,
  photo_key TEXT NOT NULL,
  suggested_slot TEXT NOT NULL,
  current_slot_value TEXT,
  confidence NUMERIC,
  dropped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Map slot_key -> column expression. CASE handles all 21 slots in SLOT_META.
WITH all_suggestions AS (
  SELECT p.id AS pole_id, p.pole_label,
         jsonb_object_keys(p.unassigned_suggestions) AS photo_key,
         p.unassigned_suggestions,
         p.civil_step_01_key, p.civil_step_02_key, p.civil_step_03_key,
         p.civil_step_04_key, p.civil_step_05_key, p.civil_step_06_key,
         p.civil_step_07_key,
         p.optical_dome_01_key, p.optical_dome_02_key, p.optical_dome_03_key,
         p.optical_dome_04_key, p.optical_dome_05_key, p.optical_dome_06_key,
         p.optical_dome_07_key, p.optical_dome_08_key,
         p.main_joint_11_key, p.main_joint_12_key, p.main_joint_13_key,
         p.main_joint_14_key, p.main_joint_15_key, p.main_joint_16_key
  FROM pole_qa_photos p
  WHERE p.unassigned_suggestions != '{}'::jsonb
),
with_slot_state AS (
  SELECT a.pole_id, a.pole_label, a.photo_key,
         a.unassigned_suggestions->a.photo_key->>'suggested_slot' AS slot_key,
         (a.unassigned_suggestions->a.photo_key->>'confidence')::numeric AS confidence,
         CASE a.unassigned_suggestions->a.photo_key->>'suggested_slot'
           WHEN 'civil_01' THEN a.civil_step_01_key
           WHEN 'civil_02' THEN a.civil_step_02_key
           WHEN 'civil_03' THEN a.civil_step_03_key
           WHEN 'civil_04' THEN a.civil_step_04_key
           WHEN 'civil_05' THEN a.civil_step_05_key
           WHEN 'civil_06' THEN a.civil_step_06_key
           WHEN 'civil_07' THEN a.civil_step_07_key
           WHEN 'dome_01'  THEN a.optical_dome_01_key
           WHEN 'dome_02'  THEN a.optical_dome_02_key
           WHEN 'dome_03'  THEN a.optical_dome_03_key
           WHEN 'dome_04'  THEN a.optical_dome_04_key
           WHEN 'dome_05'  THEN a.optical_dome_05_key
           WHEN 'dome_06'  THEN a.optical_dome_06_key
           WHEN 'dome_07'  THEN a.optical_dome_07_key
           WHEN 'dome_08'  THEN a.optical_dome_08_key
           WHEN 'main_joint_11' THEN a.main_joint_11_key
           WHEN 'main_joint_12' THEN a.main_joint_12_key
           WHEN 'main_joint_13' THEN a.main_joint_13_key
           WHEN 'main_joint_14' THEN a.main_joint_14_key
           WHEN 'main_joint_15' THEN a.main_joint_15_key
           WHEN 'main_joint_16' THEN a.main_joint_16_key
         END AS current_slot_value
  FROM all_suggestions a
),
to_drop AS (
  SELECT * FROM with_slot_state WHERE current_slot_value IS NOT NULL
)
INSERT INTO works_qa_dropped_suggestions_2026_05_22
  (pole_id, pole_label, photo_key, suggested_slot, current_slot_value, confidence)
SELECT pole_id, pole_label, photo_key, slot_key, current_slot_value, confidence
FROM to_drop;

DO $$
DECLARE drop_count INT;
BEGIN
  SELECT count(*) INTO drop_count FROM works_qa_dropped_suggestions_2026_05_22;
  RAISE NOTICE 'Dropping % filled-slot suggestions', drop_count;
  IF drop_count > 5000 THEN
    RAISE EXCEPTION 'Too many to drop (% > 5000) — aborting for safety', drop_count;
  END IF;
END $$;

-- Strip dropped suggestions from each pole's JSONB
UPDATE pole_qa_photos p
SET unassigned_suggestions = (
  SELECT COALESCE(jsonb_object_agg(k, p.unassigned_suggestions->k), '{}'::jsonb)
  FROM jsonb_object_keys(p.unassigned_suggestions) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM works_qa_dropped_suggestions_2026_05_22 d
    WHERE d.pole_id = p.id AND d.photo_key = k
  )
),
updated_at = NOW()
WHERE id IN (SELECT DISTINCT pole_id FROM works_qa_dropped_suggestions_2026_05_22);

-- Post-condition: zero filled-slot suggestions remain (in the dropped set)
DO $$
DECLARE residual INT;
BEGIN
  SELECT count(*) INTO residual
  FROM works_qa_dropped_suggestions_2026_05_22 d
  JOIN pole_qa_photos p ON p.id = d.pole_id
  WHERE p.unassigned_suggestions ? d.photo_key;

  IF residual > 0 THEN
    RAISE EXCEPTION 'Post-condition failed: % suggestion entries still present', residual;
  END IF;
END $$;

INSERT INTO migrations (version, name, executed_at)
VALUES ('375', 'works_qa_drop_filled_slot_suggestions', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
