-- Migration 240: Optical Discipline Consolidation
--
-- Consolidates three disciplines (civil, optical, splicing) into two (civil, optical).
-- The new "optical" discipline encompasses what was previously called "splicing"
-- (dome joint installation). The old optical cable-stringing columns are dropped.
--
-- Steps:
--   1. Drop old optical (cable stringing) checklist columns
--   2. Rename all splicing_step_* columns to optical_step_*
--   3. Update discipline values: splicing → optical
--   4. Drop and recreate the CHECK constraint

BEGIN;

-- ── 0. Drop dependent view (will be recreated after column renames) ──────────
DROP VIEW IF EXISTS v_construction_qa_reviews CASCADE;

-- ── 1. Drop old optical (cable stringing) checklist columns ──────────────────
ALTER TABLE construction_qa_reviews
  DROP COLUMN IF EXISTS optical_step_01_cable_route,
  DROP COLUMN IF EXISTS optical_step_02_attachment,
  DROP COLUMN IF EXISTS optical_step_03_slack_coil,
  DROP COLUMN IF EXISTS optical_step_04_cable_label,
  DROP COLUMN IF EXISTS optical_step_05_no_backfeed,
  DROP COLUMN IF EXISTS optical_step_06_sag_ok;

-- ── 2. Rename splicing columns to optical ────────────────────────────────────
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_01_dome_on_pole    TO optical_step_01_dome_on_pole;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_02_dome_label      TO optical_step_02_dome_label;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_03_open_dome       TO optical_step_03_open_dome;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_04_splice_protectors TO optical_step_04_splice_protectors;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_05_slack_management TO optical_step_05_slack_management;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_06_strength_members TO optical_step_06_strength_members;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_07_seals_dustcaps   TO optical_step_07_seals_dustcaps;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_08_pole_id          TO optical_step_08_pole_id;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_11_cable_entries    TO optical_step_11_cable_entries;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_12_strength_members TO optical_step_12_strength_members;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_13_tube_routing     TO optical_step_13_tube_routing;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_14_tray_entries     TO optical_step_14_tray_entries;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_15_coiling_protectors TO optical_step_15_coiling_protectors;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_16_readable_labels  TO optical_step_16_readable_labels;

-- ── 2b. Rename splicing_sub_type column ──────────────────────────────────────
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_sub_type TO optical_sub_type;

-- ── 3. Migrate discipline values ──────────────────────────────────────────────
UPDATE construction_qa_reviews
  SET discipline = 'optical'
  WHERE discipline = 'splicing';

-- ── 4. Update CHECK constraint ────────────────────────────────────────────────
-- Drop existing constraint (name may vary; use pg_constraint to find it)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'construction_qa_reviews'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%discipline%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE construction_qa_reviews DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE construction_qa_reviews
  ADD CONSTRAINT construction_qa_reviews_discipline_check
  CHECK (discipline IN ('civil', 'optical'));

COMMIT;
