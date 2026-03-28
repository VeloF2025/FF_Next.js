-- Migration 261: Pole Construction Checklist
-- Structured per-pole lifecycle tracking — replaces flat varchar columns on poles table.
--
-- Each pole goes through construction steps. Each step has:
--   status, date, agent, photo, QA review
--
-- This enables queries like:
--   "Poles planted but missing slack brackets"
--   "Civil audit complete but no optical audit"
--   "Per-PON completion % by discipline"

-- ─────────────────────────────────────────────────────────────────────
-- 1. Reference table: defines the standard checklist steps
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pole_checklist_steps_ref (
  step_key        VARCHAR(50)   PRIMARY KEY,
  step_order      INTEGER       NOT NULL,
  discipline      VARCHAR(30)   NOT NULL,  -- 'civil', 'optical', 'stringing'
  label           VARCHAR(100)  NOT NULL,
  description     TEXT,
  requires_photo  BOOLEAN       NOT NULL DEFAULT true,
  is_active       BOOLEAN       NOT NULL DEFAULT true
);

-- Seed the standard steps
INSERT INTO pole_checklist_steps_ref (step_key, step_order, discipline, label, description, requires_photo) VALUES
  ('pole_planted',       1,  'civil',     'Pole Planted',         'Pole physically planted in the ground',              true),
  ('tangent_brackets',   2,  'civil',     'Tangent Brackets',     'Tangent/angle brackets installed on pole',           true),
  ('slack_brackets',     3,  'civil',     'Slack Brackets',       'Slack storage brackets installed',                   true),
  ('dome_joint',         4,  'optical',   'Dome Joint',           'Dome joint enclosure installed on pole',             true),
  ('splitter',           5,  'optical',   'Splitter',             'Optical splitter installed (type + capacity)',        true),
  ('stringing',          6,  'stringing', 'Cable Strung',         'Fiber cable strung through to this pole',            true),
  ('civil_audit',        7,  'civil',     'Civil Audit',          'Civil QA inspection completed',                      true),
  ('optical_splice',     8,  'optical',   'Optical Splice',       'Splice completed inside dome joint',                 true),
  ('optical_test',       9,  'optical',   'Optical Test',         'OTDR / power meter test completed',                  true),
  ('optical_audit',     10,  'optical',   'Optical Audit',        'Optical QA inspection completed',                    true)
ON CONFLICT (step_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Per-pole checklist records
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pole_checklist (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID          NOT NULL REFERENCES projects(id),
  pole_id         UUID          NOT NULL,  -- FK to poles.id
  pole_number     VARCHAR(255)  NOT NULL,  -- denormalized for quick queries
  step_key        VARCHAR(50)   NOT NULL REFERENCES pole_checklist_steps_ref(step_key),

  -- Status
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
    -- 'pending', 'done', 'na', 'failed'
  completed_at    TIMESTAMPTZ,
  completed_by    VARCHAR(255),            -- field agent name

  -- Component details (for dome_joint, splitter steps)
  component_type  VARCHAR(100),            -- e.g. 'Enclosure', '1:8', '1:16'
  component_value VARCHAR(255),            -- e.g. joint type, splitter capacity

  -- Photo evidence
  photo_key       TEXT,                    -- VF Storage / MinIO path
  photo_source    VARCHAR(30),             -- 'qfield', 'whatsapp', 'manual'

  -- QA Review
  qa_status       VARCHAR(20),             -- 'approved', 'rejected', NULL
  qa_reviewed_by  VARCHAR(255),
  qa_reviewed_at  TIMESTAMPTZ,
  qa_comments     TEXT,

  -- Source tracking
  source          VARCHAR(30)   NOT NULL DEFAULT 'qfield',
    -- 'qfield', 'manual', 'import'
  qfield_delta_id TEXT,                    -- link back to QFieldCloud delta

  -- Metadata
  metadata        JSONB         DEFAULT '{}',

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One record per pole per step
  CONSTRAINT uq_pole_checklist UNIQUE (project_id, pole_number, step_key)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pole_checklist_project     ON pole_checklist (project_id);
CREATE INDEX IF NOT EXISTS idx_pole_checklist_pole        ON pole_checklist (project_id, pole_number);
CREATE INDEX IF NOT EXISTS idx_pole_checklist_step        ON pole_checklist (step_key, status);
CREATE INDEX IF NOT EXISTS idx_pole_checklist_status      ON pole_checklist (project_id, status);
CREATE INDEX IF NOT EXISTS idx_pole_checklist_qa          ON pole_checklist (qa_status) WHERE qa_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pole_checklist_pole_id     ON pole_checklist (pole_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. View: pole completion summary (per pole)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pole_completion AS
SELECT
  p.project_id,
  p.pole_number,
  p.pole_id,
  p.zone_no,
  p.pon_no,
  COUNT(pc.id) FILTER (WHERE pc.status = 'done')  AS steps_done,
  COUNT(pc.id) FILTER (WHERE pc.status = 'pending') AS steps_pending,
  COUNT(pc.id) FILTER (WHERE pc.status = 'failed') AS steps_failed,
  COUNT(r.step_key) AS steps_total,
  ROUND(
    COUNT(pc.id) FILTER (WHERE pc.status = 'done')::numeric /
    NULLIF(COUNT(r.step_key), 0) * 100, 1
  ) AS pct_complete,
  -- Discipline breakdowns
  COUNT(pc.id) FILTER (WHERE pc.status = 'done' AND r.discipline = 'civil')    AS civil_done,
  COUNT(r.step_key) FILTER (WHERE r.discipline = 'civil')                       AS civil_total,
  COUNT(pc.id) FILTER (WHERE pc.status = 'done' AND r.discipline = 'optical')  AS optical_done,
  COUNT(r.step_key) FILTER (WHERE r.discipline = 'optical')                     AS optical_total,
  COUNT(pc.id) FILTER (WHERE pc.status = 'done' AND r.discipline = 'stringing') AS stringing_done,
  COUNT(r.step_key) FILTER (WHERE r.discipline = 'stringing')                   AS stringing_total,
  -- Key milestone flags
  bool_or(pc.status = 'done' AND pc.step_key = 'pole_planted')    AS is_planted,
  bool_or(pc.status = 'done' AND pc.step_key = 'tangent_brackets') AS has_tangent,
  bool_or(pc.status = 'done' AND pc.step_key = 'slack_brackets')  AS has_slack,
  bool_or(pc.status = 'done' AND pc.step_key = 'dome_joint')      AS has_dome_joint,
  bool_or(pc.status = 'done' AND pc.step_key = 'splitter')        AS has_splitter,
  bool_or(pc.status = 'done' AND pc.step_key = 'stringing')       AS is_strung,
  bool_or(pc.status = 'done' AND pc.step_key = 'civil_audit')     AS civil_audited,
  bool_or(pc.status = 'done' AND pc.step_key = 'optical_audit')   AS optical_audited
FROM poles p
CROSS JOIN pole_checklist_steps_ref r
LEFT JOIN pole_checklist pc
  ON pc.project_id = p.project_id
  AND pc.pole_number = p.pole_number
  AND pc.step_key = r.step_key
WHERE r.is_active = true
GROUP BY p.project_id, p.pole_number, p.pole_id, p.zone_no, p.pon_no;

-- ─────────────────────────────────────────────────────────────────────
-- 4. View: PON-level rollup
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pon_pole_progress AS
SELECT
  project_id,
  pon_no,
  zone_no,
  COUNT(DISTINCT pole_number) AS total_poles,
  COUNT(DISTINCT pole_number) FILTER (WHERE is_planted)        AS poles_planted,
  COUNT(DISTINCT pole_number) FILTER (WHERE has_tangent)       AS poles_with_tangent,
  COUNT(DISTINCT pole_number) FILTER (WHERE has_slack)         AS poles_with_slack,
  COUNT(DISTINCT pole_number) FILTER (WHERE has_dome_joint)    AS poles_with_dome_joint,
  COUNT(DISTINCT pole_number) FILTER (WHERE has_splitter)      AS poles_with_splitter,
  COUNT(DISTINCT pole_number) FILTER (WHERE is_strung)         AS poles_strung,
  COUNT(DISTINCT pole_number) FILTER (WHERE civil_audited)     AS poles_civil_audited,
  COUNT(DISTINCT pole_number) FILTER (WHERE optical_audited)   AS poles_optical_audited,
  ROUND(AVG(pct_complete), 1) AS avg_completion_pct
FROM v_pole_completion
GROUP BY project_id, pon_no, zone_no;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Track migration
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO _migrations (id, name, applied_at)
VALUES (261, '261_pole_construction_checklist', NOW())
ON CONFLICT (id) DO NOTHING;
