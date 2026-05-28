-- Migration 388: Works QA civil step 8 ("Pole Label") slot
--
-- QField civil/pole_installation jobs capture an 8th photo: the pole ID label/tag
-- on the installed pole. Until now CIVIL_STEP_MAP routed step 8 into the optical
-- `dome_08` slot (a pragmatic share — see commit d1517023f) so the photo wasn't
-- lost, but on civil-only poles it surfaced under "Optical Dome", which confuses
-- reviewers and leaves the Civil discipline showing 7/7 with no Pole Label.
--
-- This adds a dedicated civil slot so the Pole Label photo renders under Civil and
-- counts toward the civil approval gate (now 8/8). The slot is data-driven via
-- SLOT_META, so adding the column + SLOT_META entry is all the gate/UI need.

ALTER TABLE pole_qa_photos
  ADD COLUMN IF NOT EXISTS civil_step_08_key TEXT;

INSERT INTO migrations (version, name)
  VALUES (388, 'works_qa_civil_step_08')
  ON CONFLICT (version) DO NOTHING;
