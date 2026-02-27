-- Migration: 222_checklist_steps_spec_alignment.sql
-- Description: Align checklist step columns with Velocity Fibre / Fibertime spec documents:
--   - Pole Install Capture Checklist (8 steps across 3 phases)
--   - Optical Checklist: Distribution Dome (8 steps) + Main Joint (6 steps)
-- Also clears all existing checklist_step/step_label values since prior VLM
-- classifications used wrong step definitions.
-- Date: 2026-02-28

BEGIN;

-- ============================================================================
-- 1. Civil (Pole Install) — rename 7 existing columns + add step 08
-- ============================================================================
-- Old: foundation, full_pole, pole_label, cca_tag, vertical, guy_wires, slack_bracket
-- New: before_photo, during_photo, depth_photo, end_plates, compaction, level_check, after_photo, signature

ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_01_foundation    TO civil_step_01_before_photo;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_02_full_pole     TO civil_step_02_during_photo;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_03_pole_label    TO civil_step_03_depth_photo;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_04_cca_tag       TO civil_step_04_end_plates;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_05_vertical      TO civil_step_05_compaction;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_06_guy_wires     TO civil_step_06_level_check;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN civil_step_07_slack_bracket TO civil_step_07_after_photo;

ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS civil_step_08_signature BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 2. Splicing — rename 7 existing columns for Distribution Dome (8 steps)
--    + add splicing_step_08 and 6 Main Joint columns
-- ============================================================================
-- Old: dome_closed, slack_bracket, emergency_loop, backhaul_sep, tray_org, heat_shrinks, dome_label
-- New Dome: dome_on_pole, dome_label, open_dome, splice_protectors, slack_management, strength_members, seals_dustcaps, pole_id
-- New Joint (steps 11-16): cable_entries, strength_members, tube_routing, tray_entries, coiling_protectors, readable_labels

ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_01_dome_closed    TO splicing_step_01_dome_on_pole;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_02_slack_bracket  TO splicing_step_02_dome_label;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_03_emergency_loop TO splicing_step_03_open_dome;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_04_backhaul_sep   TO splicing_step_04_splice_protectors;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_05_tray_org       TO splicing_step_05_slack_management;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_06_heat_shrinks   TO splicing_step_06_strength_members;
ALTER TABLE construction_qa_reviews
  RENAME COLUMN splicing_step_07_dome_label     TO splicing_step_07_seals_dustcaps;

ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS splicing_step_08_pole_id BOOLEAN DEFAULT FALSE;

-- Main Joint columns (steps 11-16, offset by 10 to differentiate from Dome steps 1-8)
ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS splicing_step_11_cable_entries      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS splicing_step_12_strength_members   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS splicing_step_13_tube_routing       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS splicing_step_14_tray_entries       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS splicing_step_15_coiling_protectors BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS splicing_step_16_readable_labels    BOOLEAN DEFAULT FALSE;

-- Sub-type field to distinguish dome vs main joint
ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS splicing_sub_type TEXT CHECK (splicing_sub_type IN ('dome', 'main_joint'));

-- ============================================================================
-- 3. Reset all step booleans — existing classifications are wrong
-- ============================================================================
UPDATE construction_qa_reviews SET
  -- Civil
  civil_step_01_before_photo = FALSE,
  civil_step_02_during_photo = FALSE,
  civil_step_03_depth_photo = FALSE,
  civil_step_04_end_plates = FALSE,
  civil_step_05_compaction = FALSE,
  civil_step_06_level_check = FALSE,
  civil_step_07_after_photo = FALSE,
  civil_step_08_signature = FALSE,
  -- Splicing Dome
  splicing_step_01_dome_on_pole = FALSE,
  splicing_step_02_dome_label = FALSE,
  splicing_step_03_open_dome = FALSE,
  splicing_step_04_splice_protectors = FALSE,
  splicing_step_05_slack_management = FALSE,
  splicing_step_06_strength_members = FALSE,
  splicing_step_07_seals_dustcaps = FALSE,
  splicing_step_08_pole_id = FALSE,
  -- Splicing Joint
  splicing_step_11_cable_entries = FALSE,
  splicing_step_12_strength_members = FALSE,
  splicing_step_13_tube_routing = FALSE,
  splicing_step_14_tray_entries = FALSE,
  splicing_step_15_coiling_protectors = FALSE,
  splicing_step_16_readable_labels = FALSE,
  -- Optical (unchanged schema but reset values)
  optical_step_01_cable_route = FALSE,
  optical_step_02_attachment = FALSE,
  optical_step_03_slack_coil = FALSE,
  optical_step_04_cable_label = FALSE,
  optical_step_05_no_backfeed = FALSE,
  optical_step_06_sag_ok = FALSE,
  updated_at = NOW()
WHERE TRUE;

-- ============================================================================
-- 4. Clear all photo classifications — will be re-classified by VLM
-- ============================================================================
UPDATE construction_qa_photos SET
  checklist_step = NULL,
  step_label = NULL,
  vlm_confidence = NULL,
  vlm_feedback = NULL,
  vlm_processed_at = NULL,
  updated_at = NOW()
WHERE checklist_step IS NOT NULL OR step_label IS NOT NULL;

COMMIT;
