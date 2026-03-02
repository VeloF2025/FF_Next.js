-- Migration 229: Pole Install Sessions — real-time photo ACK tracking
-- Tracks per-pole photo progress during civil installation
-- Photos classified by VLM into steps (before, depth, stumping, etc.)

-- ============================================================================
-- 1. Pole Install Sessions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS pole_install_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  wa_group_jid VARCHAR(100) NOT NULL,
  pole_number VARCHAR(100),
  sender_jid VARCHAR(100),
  sender_name VARCHAR(200),

  -- Photo counts per category
  before_count INTEGER DEFAULT 0,         -- need 3 (different angles of marked ground)
  depth_count INTEGER DEFAULT 0,          -- need 1 (measuring tape in hole)
  stumping_count INTEGER DEFAULT 0,       -- need 3 (pole planted, various angles)
  compaction_count INTEGER DEFAULT 0,     -- need 1 (cement/soil, corner poles)
  housekeeping_count INTEGER DEFAULT 0,   -- need 3 (clean site)

  -- Less common steps (still tracked if detected by VLM)
  during_count INTEGER DEFAULT 0,         -- digging/preparation
  endplate_count INTEGER DEFAULT 0,       -- end plates visible
  level_count INTEGER DEFAULT 0,          -- spirit level (bonus)
  signature_count INTEGER DEFAULT 0,      -- sign-off sheet

  -- Totals
  total_photos INTEGER DEFAULT 0,
  required_photos INTEGER DEFAULT 11,     -- 14 for corner poles
  status VARCHAR(20) DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'complete', 'flagged', 'abandoned')),
  is_corner_pole BOOLEAN DEFAULT FALSE,

  -- Cross-reference
  pole_verified BOOLEAN DEFAULT FALSE,
  pole_exists_in_sow BOOLEAN,
  cross_ref_issues TEXT[],

  -- QA link (created when session completes)
  construction_qa_review_id UUID,

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_photo_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  ack_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pole_sessions_group ON pole_install_sessions(wa_group_jid);
CREATE INDEX IF NOT EXISTS idx_pole_sessions_pole ON pole_install_sessions(pole_number);
CREATE INDEX IF NOT EXISTS idx_pole_sessions_active ON pole_install_sessions(status)
  WHERE status = 'in_progress';

-- ============================================================================
-- 2. Add columns to field_ops_wa_photos for session linking
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'field_ops_wa_photos' AND column_name = 'pole_install_session_id'
  ) THEN
    ALTER TABLE field_ops_wa_photos
      ADD COLUMN pole_install_session_id UUID REFERENCES pole_install_sessions(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'field_ops_wa_photos' AND column_name = 'classified_step'
  ) THEN
    ALTER TABLE field_ops_wa_photos
      ADD COLUMN classified_step VARCHAR(20);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fo_wa_photos_session
  ON field_ops_wa_photos(pole_install_session_id)
  WHERE pole_install_session_id IS NOT NULL;
