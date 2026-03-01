-- Migration 228: Field Ops WhatsApp Tracking
-- Adds tables for civil/optical group message tracking, photo VLM validation,
-- and project linking for wa_monitored_groups.

-- ============================================================================
-- 1. Field Ops WhatsApp Messages (civil/optical group messages)
-- ============================================================================
CREATE TABLE IF NOT EXISTS field_ops_wa_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id VARCHAR(100) UNIQUE NOT NULL,
  wa_group_jid VARCHAR(100) NOT NULL,
  group_type VARCHAR(20) NOT NULL,  -- 'civil' | 'optical'
  sender_jid VARCHAR(100),
  sender_name VARCHAR(200),
  message_text TEXT,
  message_timestamp TIMESTAMPTZ NOT NULL,
  project VARCHAR(100),
  has_media BOOLEAN DEFAULT FALSE,
  media_type VARCHAR(50),
  media_count INTEGER DEFAULT 0,
  processed BOOLEAN DEFAULT FALSE,
  digest_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fo_wa_msgs_group ON field_ops_wa_messages(wa_group_jid);
CREATE INDEX IF NOT EXISTS idx_fo_wa_msgs_date ON field_ops_wa_messages(message_timestamp);
CREATE INDEX IF NOT EXISTS idx_fo_wa_msgs_digest ON field_ops_wa_messages(digest_date) WHERE digest_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_fo_wa_msgs_project ON field_ops_wa_messages(project);

-- ============================================================================
-- 2. Field Ops WhatsApp Photos (pending VLM validation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS field_ops_wa_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES field_ops_wa_messages(id),
  wa_media_id VARCHAR(100),
  wa_group_jid VARCHAR(100) NOT NULL,
  group_type VARCHAR(20) NOT NULL,
  sender_jid VARCHAR(100),
  sender_name VARCHAR(200),
  message_timestamp TIMESTAMPTZ NOT NULL,
  project VARCHAR(100),
  original_filename VARCHAR(255),
  mime_type VARCHAR(100) DEFAULT 'image/jpeg',
  local_path TEXT,
  storage_key TEXT,
  upload_status VARCHAR(20) DEFAULT 'pending',
  -- VLM fields
  vlm_processed BOOLEAN DEFAULT FALSE,
  vlm_valid BOOLEAN,
  vlm_confidence DECIMAL(4,3),
  vlm_issues TEXT[],
  vlm_feedback TEXT,
  vlm_processed_at TIMESTAMPTZ,
  -- Cross-reference fields
  cross_ref_valid BOOLEAN,
  cross_ref_issues TEXT[],
  matched_pole_number VARCHAR(100),
  matched_zone_no INTEGER,
  matched_pon_no INTEGER,
  -- Construction QA link
  construction_qa_photo_id UUID,
  construction_qa_review_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fo_wa_photos_pending ON field_ops_wa_photos(vlm_processed) WHERE vlm_processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_fo_wa_photos_upload ON field_ops_wa_photos(upload_status) WHERE upload_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fo_wa_photos_message ON field_ops_wa_photos(message_id);
CREATE INDEX IF NOT EXISTS idx_fo_wa_photos_project ON field_ops_wa_photos(project);

-- ============================================================================
-- 3. Add project_id to wa_monitored_groups for project linking
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wa_monitored_groups' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE wa_monitored_groups ADD COLUMN project_id UUID REFERENCES projects(id);
  END IF;
END $$;

-- Backfill existing groups by matching project name
UPDATE wa_monitored_groups mg
SET project_id = p.id
FROM projects p
WHERE mg.project_name IS NOT NULL
  AND mg.project_id IS NULL
  AND LOWER(mg.project_name) = LOWER(p.project_name);
