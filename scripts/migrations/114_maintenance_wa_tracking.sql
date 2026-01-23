-- Migration: 110_maintenance_wa_tracking.sql
-- Description: Create tables for Mohadin QA WhatsApp maintenance tracking
-- Date: 2026-01-23

-- ============================================================================
-- Table 1: maintenance_wa_messages
-- Stores all WhatsApp messages from the maintenance group
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_wa_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id VARCHAR(100) UNIQUE NOT NULL,
  wa_group_jid VARCHAR(100) NOT NULL,
  sender_jid VARCHAR(100) NOT NULL,
  sender_name VARCHAR(200),
  message_text TEXT,
  message_timestamp TIMESTAMPTZ NOT NULL,

  -- DR association
  drop_number VARCHAR(20),  -- Extracted or context-linked
  dr_mentioned_directly BOOLEAN DEFAULT false,  -- Was DR in this message?
  project VARCHAR(100),  -- Project name (e.g., Mohadin)

  -- Media
  has_media BOOLEAN DEFAULT false,
  media_type VARCHAR(50),  -- image, video, document
  media_count INTEGER DEFAULT 0,

  -- Processing status
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for maintenance_wa_messages
CREATE INDEX IF NOT EXISTS idx_maint_wa_drop ON maintenance_wa_messages(drop_number);
CREATE INDEX IF NOT EXISTS idx_maint_wa_sender ON maintenance_wa_messages(sender_jid, message_timestamp);
CREATE INDEX IF NOT EXISTS idx_maint_wa_group ON maintenance_wa_messages(wa_group_jid);
CREATE INDEX IF NOT EXISTS idx_maint_wa_timestamp ON maintenance_wa_messages(message_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_maint_wa_processed ON maintenance_wa_messages(processed) WHERE processed = false;

-- ============================================================================
-- Table 2: maintenance_wa_photos
-- Stores photo metadata and SharePoint references
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_wa_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES maintenance_wa_messages(id) ON DELETE CASCADE,
  drop_number VARCHAR(20) NOT NULL,
  project VARCHAR(100),

  -- Photo metadata
  wa_media_id VARCHAR(100),
  original_filename VARCHAR(255),
  mime_type VARCHAR(100),
  file_size_bytes INTEGER,

  -- Storage
  sharepoint_url TEXT,
  sharepoint_item_id VARCHAR(100),
  firebase_url TEXT,  -- Fallback storage
  local_path TEXT,  -- Temp storage before upload

  -- Classification
  photo_source VARCHAR(50) DEFAULT 'whatsapp_maintenance',
  photo_type VARCHAR(50),  -- evidence, before, after, screenshot, etc.
  photo_index INTEGER DEFAULT 1,  -- Order within message

  -- Upload status
  upload_status VARCHAR(50) DEFAULT 'pending',  -- pending, uploading, uploaded, failed
  upload_error TEXT,
  uploaded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for maintenance_wa_photos
CREATE INDEX IF NOT EXISTS idx_maint_photo_dr ON maintenance_wa_photos(drop_number);
CREATE INDEX IF NOT EXISTS idx_maint_photo_message ON maintenance_wa_photos(message_id);
CREATE INDEX IF NOT EXISTS idx_maint_photo_status ON maintenance_wa_photos(upload_status);

-- ============================================================================
-- Table 3: dr_maintenance_flags
-- Links DRs to maintenance status and aggregates data
-- ============================================================================
CREATE TABLE IF NOT EXISTS dr_maintenance_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(20) NOT NULL,
  project VARCHAR(100),

  -- Status
  has_maintenance_issue BOOLEAN DEFAULT true,
  issue_status VARCHAR(50) DEFAULT 'flagged',  -- flagged, reviewing, ticket_created, resolved
  issue_type VARCHAR(100),  -- offline, damage, quality, customer_complaint, etc.
  issue_description TEXT,

  -- Links
  maintenance_ticket_id UUID,  -- Reference to maintenance_tickets table
  arc_report_id UUID,  -- Reference to arc_reports if exists
  arc_offline_status VARCHAR(50),  -- Status from ARC report

  -- Counts (denormalized for performance)
  wa_message_count INTEGER DEFAULT 0,
  wa_photo_count INTEGER DEFAULT 0,

  -- Timestamps
  first_reported_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,  -- User who resolved

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(drop_number)
);

-- Indexes for dr_maintenance_flags
CREATE INDEX IF NOT EXISTS idx_maint_flags_status ON dr_maintenance_flags(issue_status);
CREATE INDEX IF NOT EXISTS idx_maint_flags_project ON dr_maintenance_flags(project);
CREATE INDEX IF NOT EXISTS idx_maint_flags_ticket ON dr_maintenance_flags(maintenance_ticket_id);
CREATE INDEX IF NOT EXISTS idx_maint_flags_last_activity ON dr_maintenance_flags(last_activity_at DESC);

-- ============================================================================
-- Table 4: maintenance_wa_sender_context
-- Tracks last DR mentioned by each sender for photo association
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_wa_sender_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_group_jid VARCHAR(100) NOT NULL,
  sender_jid VARCHAR(100) NOT NULL,
  last_drop_number VARCHAR(20),
  last_drop_timestamp TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(wa_group_jid, sender_jid)
);

-- Index for quick context lookup
CREATE INDEX IF NOT EXISTS idx_sender_context_lookup
  ON maintenance_wa_sender_context(wa_group_jid, sender_jid);

-- ============================================================================
-- Function: Update maintenance flag counts
-- ============================================================================
CREATE OR REPLACE FUNCTION update_maintenance_flag_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- Update message count
  UPDATE dr_maintenance_flags
  SET
    wa_message_count = (
      SELECT COUNT(*) FROM maintenance_wa_messages
      WHERE drop_number = NEW.drop_number
    ),
    last_activity_at = NOW(),
    updated_at = NOW()
  WHERE drop_number = NEW.drop_number;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for message count updates
DROP TRIGGER IF EXISTS trg_update_maint_msg_count ON maintenance_wa_messages;
CREATE TRIGGER trg_update_maint_msg_count
AFTER INSERT ON maintenance_wa_messages
FOR EACH ROW
WHEN (NEW.drop_number IS NOT NULL)
EXECUTE FUNCTION update_maintenance_flag_counts();

-- ============================================================================
-- Function: Update photo count
-- ============================================================================
CREATE OR REPLACE FUNCTION update_maintenance_photo_counts()
RETURNS TRIGGER AS $$
BEGIN
  -- Update photo count
  UPDATE dr_maintenance_flags
  SET
    wa_photo_count = (
      SELECT COUNT(*) FROM maintenance_wa_photos
      WHERE drop_number = NEW.drop_number
    ),
    last_activity_at = NOW(),
    updated_at = NOW()
  WHERE drop_number = NEW.drop_number;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for photo count updates
DROP TRIGGER IF EXISTS trg_update_maint_photo_count ON maintenance_wa_photos;
CREATE TRIGGER trg_update_maint_photo_count
AFTER INSERT ON maintenance_wa_photos
FOR EACH ROW
EXECUTE FUNCTION update_maintenance_photo_counts();

-- ============================================================================
-- Function: Auto-create maintenance flag when DR first mentioned
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_create_maintenance_flag()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if DR was mentioned and flag doesn't exist
  IF NEW.drop_number IS NOT NULL AND NEW.dr_mentioned_directly = true THEN
    INSERT INTO dr_maintenance_flags (drop_number, project, first_reported_at)
    VALUES (NEW.drop_number, NEW.project, NEW.message_timestamp)
    ON CONFLICT (drop_number) DO UPDATE
    SET
      last_activity_at = NOW(),
      wa_message_count = dr_maintenance_flags.wa_message_count + 1,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-creating maintenance flags
DROP TRIGGER IF EXISTS trg_auto_create_maint_flag ON maintenance_wa_messages;
CREATE TRIGGER trg_auto_create_maint_flag
AFTER INSERT ON maintenance_wa_messages
FOR EACH ROW
EXECUTE FUNCTION auto_create_maintenance_flag();

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE maintenance_wa_messages IS 'WhatsApp messages from maintenance QA groups';
COMMENT ON TABLE maintenance_wa_photos IS 'Photos from maintenance WhatsApp messages, synced to SharePoint';
COMMENT ON TABLE dr_maintenance_flags IS 'Maintenance issue tracking per DR, links to tickets and ARC reports';
COMMENT ON TABLE maintenance_wa_sender_context IS 'Tracks last DR mentioned per sender for associating follow-up photos';

COMMENT ON COLUMN maintenance_wa_messages.dr_mentioned_directly IS 'True if DR number was in this message text, false if associated via context';
COMMENT ON COLUMN maintenance_wa_photos.photo_source IS 'Differentiates from 1Map photos: whatsapp_maintenance, whatsapp_qa, onemap, ticket';
COMMENT ON COLUMN dr_maintenance_flags.issue_status IS 'Workflow: flagged -> reviewing -> ticket_created -> resolved';
