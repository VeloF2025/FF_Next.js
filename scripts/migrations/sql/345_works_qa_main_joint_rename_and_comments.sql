-- Migration 345: Works QA — rename optical_joint_* → main_joint_*, add per-discipline comments table
--
-- Two changes:
--  1. Rename the 6 fixed joint slot columns and the tray array column to use
--     'main_joint_' prefix. The DB column 'joint_approved' stays (it's the
--     discipline approval flag; renaming would cascade into too much app code).
--  2. New pole_qa_comments table — audit trail. Each new comment appends, never
--     overwrites. UI shows the whole history per discipline.

-- ============================================================
-- SECTION 1: Rename columns (idempotent via IF EXISTS / IF NOT EXISTS)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_11_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_11_key TO main_joint_11_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_12_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_12_key TO main_joint_12_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_13_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_13_key TO main_joint_13_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_14_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_14_key TO main_joint_14_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_15_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_15_key TO main_joint_15_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_16_key') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_16_key TO main_joint_16_key;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pole_qa_photos' AND column_name='optical_joint_tray_keys') THEN
    ALTER TABLE pole_qa_photos RENAME COLUMN optical_joint_tray_keys TO main_joint_tray_keys;
  END IF;
END $$;

-- ============================================================
-- SECTION 2: pole_qa_comments — audit trail per discipline
-- ============================================================

CREATE TABLE IF NOT EXISTS pole_qa_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pole_qa_id    UUID NOT NULL REFERENCES pole_qa_photos(id) ON DELETE CASCADE,
  discipline    TEXT NOT NULL CHECK (discipline IN ('civil', 'dome', 'main_joint')),
  comment       TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pole_qa_comments_pole_discipline
  ON pole_qa_comments(pole_qa_id, discipline, created_at DESC);

-- Report (for run logs)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='pole_qa_photos' AND column_name LIKE 'main_joint_%') AS main_joint_cols,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='pole_qa_comments') AS comments_table_exists;
