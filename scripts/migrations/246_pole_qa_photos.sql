-- Works QA Dashboard: pole photo slot storage for Johan's sweep workflow.
-- One row per pole per project. Fixed text-key columns for 21 checklist slots
-- plus a TEXT[] for variable tray photos.

CREATE TABLE IF NOT EXISTS pole_qa_photos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pole_label                TEXT NOT NULL,
  zone_no                   INTEGER,
  pon_no                    INTEGER,

  -- Civil (CIVIL_CHECKLIST steps 1-7)
  civil_step_01_key         TEXT,
  civil_step_02_key         TEXT,
  civil_step_03_key         TEXT,
  civil_step_04_key         TEXT,
  civil_step_05_key         TEXT,
  civil_step_06_key         TEXT,
  civil_step_07_key         TEXT,

  -- Optical Dome (OPTICAL_DOME_CHECKLIST steps 1-8)
  optical_dome_01_key       TEXT,
  optical_dome_02_key       TEXT,
  optical_dome_03_key       TEXT,
  optical_dome_04_key       TEXT,
  optical_dome_05_key       TEXT,
  optical_dome_06_key       TEXT,
  optical_dome_07_key       TEXT,
  optical_dome_08_key       TEXT,

  -- Optical Joint (OPTICAL_JOINT_CHECKLIST steps 11-16)
  optical_joint_11_key      TEXT,
  optical_joint_12_key      TEXT,
  optical_joint_13_key      TEXT,
  optical_joint_14_key      TEXT,
  optical_joint_15_key      TEXT,
  optical_joint_16_key      TEXT,

  -- Variable tray photos (flat bucket)
  optical_joint_tray_keys   TEXT[]  DEFAULT '{}',

  -- VLM results per slot: { "civil_01": { valid, confidence, feedback }, ... }
  vlm_results               JSONB   DEFAULT '{}',

  -- Per-discipline approval flags
  civil_approved            BOOLEAN DEFAULT FALSE,
  dome_approved             BOOLEAN DEFAULT FALSE,
  joint_approved            BOOLEAN DEFAULT FALSE,
  approved_by               TEXT,
  approved_at               TIMESTAMPTZ,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (project_id, pole_label)
);

CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_project
  ON pole_qa_photos(project_id);
CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_pon
  ON pole_qa_photos(project_id, pon_no);
CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_approved
  ON pole_qa_photos(project_id, approved_at)
  WHERE approved_at IS NOT NULL;
